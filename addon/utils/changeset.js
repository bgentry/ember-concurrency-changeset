import { all } from "ember-concurrency";
import EmberObject, { get, computed, set } from "@ember/object";
import { readOnly, not, mapBy } from "@ember/object/computed";
import { isEqual, isNone } from "@ember/utils";
import { assert } from "@ember/debug";
import Mixin from "@ember/object/mixin";
import Evented from "@ember/object/evented";
import { A as emberArray } from "@ember/array";
import { resolve } from "rsvp";
import PropertyValidator from "ember-concurrency-changeset/utils/property-validator";
import Relay from "ember-concurrency-changeset/-private/relay";

import objectToArray from "ember-changeset/utils/computed/object-to-array";
import isEmptyObject from "ember-changeset/utils/computed/is-empty-object";
import inflate from "ember-changeset/utils/computed/inflate";
import transform from "ember-changeset/utils/computed/transform";
import { CHANGESET } from "ember-changeset/utils/is-changeset";
import isObject from "ember-changeset/utils/is-object";
import isRelay from "ember-changeset/utils/is-relay";
import setNestedProperty from "ember-changeset/utils/set-nested-property";

class Change {
  constructor(value) {
    this.value = value;
  }
}

class Err {
  /* ::
  value: mixed;
  validation: ValidationErr;
  */

  constructor(value, validation) {
    this.value = value;
    this.validation = validation;
  }
}

const CONTENT = "_content";
const CHANGES = "_changes";
const ERRORS = "_errors";
const RELAY_CACHE = "_relayCache";
const PROPERTY_VALIDATORS = "_propertyValidators";
const VALIDATION_MAP = "_validationMap";
const VALIDATOR = "_validator";
const OPTIONS = "_options";
const RUNNING_VALIDATIONS = "_runningValidations";
const BEFORE_VALIDATION_EVENT = "beforeValidation";
const AFTER_VALIDATION_EVENT = "afterValidation";
const AFTER_ROLLBACK_EVENT = "afterRollback";
const defaultValidatorFn = () => true;
const defaultOptions = { skipValidate: false };

function pureAssign(...objects) {
  return Object.assign({}, ...objects);
}

let internalProps = {};
[
  CONTENT,
  CHANGES,
  ERRORS,
  RELAY_CACHE,
  PROPERTY_VALIDATORS,
  VALIDATION_MAP,
  VALIDATOR,
  OPTIONS,
  RUNNING_VALIDATIONS,
  BEFORE_VALIDATION_EVENT,
  AFTER_VALIDATION_EVENT,
].forEach(k => {
  internalProps[k] = {};
});
const InternalPropertiesMixin = Mixin.create(internalProps);

export function newChangeset(
  obj,
  validateFn,
  validationMap,
  options = defaultOptions
) {
  let args = {};
  args[CONTENT] = obj;
  args[VALIDATOR] = validateFn || defaultValidatorFn;
  args[VALIDATION_MAP] = validationMap;
  args[OPTIONS] = pureAssign(defaultOptions, options);
  return Changeset.create(args);
}

const Changeset = EmberObject.extend(Evented, InternalPropertiesMixin, {
  __changeset__: CHANGESET,

  changes: objectToArray(CHANGES, c => c.value, false),
  errors: objectToArray(
    ERRORS,
    e => ({ value: e.value, validation: e.validation }),
    true
  ),
  change: inflate(CHANGES, c => c.value),
  error: inflate(ERRORS, e => ({ value: e.value, validation: e.validation })),
  data: readOnly(CONTENT),

  isValid: isEmptyObject(ERRORS),
  isPristine: isEmptyObject(CHANGES),
  isInvalid: not("isValid").readOnly(),
  isDirty: not("isPristine").readOnly(),

  _bareChanges: transform(CHANGES, c => c.value),

  init() {
    let c = this;
    c._super(...arguments);
    c[CHANGES] = {};
    c[ERRORS] = {};
    c[RELAY_CACHE] = {};
    c[RUNNING_VALIDATIONS] = {};
    c[PROPERTY_VALIDATORS] = {};
    this._initPropertyValidators();
  },

  _initPropertyValidators() {
    if (!this[VALIDATION_MAP]) {
      return;
    }
    Object.entries(this[VALIDATION_MAP]).forEach(([key, validator]) => {
      this._initPropertyValidator(key, validator);
    });
  },

  _initPropertyValidator(key, validator) {
    let c = this;
    c[PROPERTY_VALIDATORS][key] = PropertyValidator.create({
      key,
      validator,
    });
    return c[PROPERTY_VALIDATORS][key];
  },

  _allPropertyValidators: computed(function() {
    return Object.values(this[PROPERTY_VALIDATORS]);
  }),

  _allPropertyValidatorsRunning: mapBy("_allPropertyValidators", "isRunning"),
  isValidating: computed("_allPropertyValidatorsRunning", function() {
    return this._allPropertyValidatorsRunning.some(r => r);
  }),

  /**
   * Proxies `get` to the underlying content or changed value, if present.
   */
  unknownProperty(key) {
    return this._valueFor(key);
  },

  /**
   * Stores change on the changeset.
   */
  setUnknownProperty(key, value) {
    let c = this;

    return c._setAndValidate(key, value);
  },

  /**
   * Returns the changeset to its pristine state, and discards changes and
   * errors.
   */
  rollback() {
    // Notify keys contained in relays.
    let relayCache = get(this, RELAY_CACHE);
    for (let key in relayCache) relayCache[key].rollback();

    // Get keys before reset.
    let keys = this._rollbackKeys();

    // Reset.
    set(this, RELAY_CACHE, {});
    set(this, CHANGES, {});
    set(this, ERRORS, {});
    this._notifyVirtualProperties(keys);

    this.trigger(AFTER_ROLLBACK_EVENT);
    return this;
  },

  /**
   * Validates the changeset immediately against the validationMap passed in.
   * If no key is passed into this method, it will validate all fields on the
   * validationMap and set errors accordingly. Will throw an error if no
   * validationMap is present.
   */
  validate(key) {
    let validationMap = this[VALIDATION_MAP];
    if (Object.keys(validationMap).length === 0) {
      return resolve(null);
    }

    let c = this;
    const isPlain = true;

    if (isNone(key)) {
      let allPromises = Object.keys(validationMap).map(validationKey => {
        return c._setAndValidate(
          validationKey,
          c._valueFor(validationKey, isPlain)
        );
      });

      return all(allPromises);
    }

    return c._setAndValidate(key, c._valueFor(key, isPlain));
  },

  _setAndValidate(key, newValue) {
    let content = get(this, CONTENT);
    let oldValue = get(content, key);
    let changes = get(this, CHANGES);

    let c = this;

    let propertyValidator = c[PROPERTY_VALIDATORS][key];
    if (!propertyValidator) {
      propertyValidator = this._initPropertyValidator(key, c[VALIDATOR]);
    }

    // Happy path: remove `key` from error map.
    c._deleteKey(ERRORS, key);

    // Happy path: update change map.
    if (!isEqual(oldValue, newValue)) {
      setNestedProperty(changes, key, new Change(newValue));
    } else if (key in changes) {
      c._deleteKey(CHANGES, key);
    }

    // Happy path: notify that `key` was added.
    c.notifyPropertyChange(CHANGES);
    c.notifyPropertyChange(key);

    return c[PROPERTY_VALIDATORS][key].validate.perform(
      c,
      newValue,
      oldValue,
      changes,
      content
    );
  },

  /**
   * String representation for the changeset.
   */
  toString() {
    let normalisedContent = pureAssign(get(this, CONTENT), {});
    return `changeset:${normalisedContent.toString()}`;
  },

  /**
   * Teardown relays from cache.
   */
  willDestroy() {
    let relayCache = get(this, RELAY_CACHE);
    for (let key in relayCache) relayCache[key].destroy();
  },

  /**
   * Manually add an error to the changeset. If there is an existing
   * error or change for `key`, it will be overwritten.
   */
  addError(key, error) {
    // Construct new `Err` instance.
    let newError;
    if (isObject(error)) {
      let errorLike = error;
      assert("Error must have value.", errorLike.hasOwnProperty("value"));
      assert(
        "Error must have validation.",
        errorLike.hasOwnProperty("validation")
      );
      newError = new Err(errorLike.value, errorLike.validation);
    } else {
      let validation = error;
      newError = new Err(get(this, key), validation);
    }

    let c = this;

    // Add `key` to errors map.
    let errors = get(this, ERRORS);
    setNestedProperty(errors, key, newError);
    c.notifyPropertyChange(ERRORS);

    // Notify that `key` has changed.
    c.notifyPropertyChange(key);

    // Return passed-in `error`.
    return error;
  },

  /**
   * Value for change or the original value.
   */
  _valueFor(key, plainValue = false) {
    let changes = get(this, CHANGES);
    let errors = get(this, ERRORS);
    let content = get(this, CONTENT);

    if (errors.hasOwnProperty(key)) {
      let e = errors[key];
      return e.value;
    }

    if (changes.hasOwnProperty(key)) {
      let c = changes[key];
      return c.value;
    }

    let original = get(content, key);
    if (isObject(original) && !plainValue) {
      let c = this;
      let o = original;
      return c._relayFor(key, o);
    }

    return original;
  },

  /**
   * Construct a Relay instance for an object.
   */
  _relayFor(key, value) {
    let cache = get(this, RELAY_CACHE);

    if (!(key in cache)) {
      cache[key] = Relay.create({ key, changeset: this, content: value });
    }

    return cache[key];
  },

  /**
   * Notifies virtual properties set on the changeset of a change.
   * You can specify which keys are notified by passing in an array.
   *
   * @private
   * @param {Array} keys
   * @return {Void}
   */
  _notifyVirtualProperties(keys = this._rollbackKeys()) {
    (keys || []).forEach(key => this.notifyPropertyChange(key));
  },

  /**
   * Gets the changes and error keys.
   */
  _rollbackKeys() {
    let changes = get(this, CHANGES);
    let errors = get(this, ERRORS);
    return emberArray([...Object.keys(changes), ...Object.keys(errors)]).uniq();
  },

  _deleteKey(objName, key = "") {
    let obj = get(this, objName);
    if (obj.hasOwnProperty(key)) delete obj[key];
    let c = this;
    c.notifyPropertyChange(`${objName}.${key}`);
    c.notifyPropertyChange(objName);
  },

  /**
   * Overrides `Ember.Object.get`.
   *
   * If the returned value is a Relay, return the Relay's underlying
   * content instead.
   *
   * Otherwise, this method is equivalent to `Ember.Object.get`.
   */
  get(keyName) {
    let result = this._super(keyName);
    if (isRelay(result)) return get(result, "content");
    return result;
  },
});

export default Changeset;
