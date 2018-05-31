import EmberObject, { get } from "@ember/object";
import { readOnly } from "@ember/object/computed";
import { task } from "ember-concurrency";
import { isArray } from "@ember/array";
import { typeOf, isPresent } from "@ember/utils";

const PropertyValidator = EmberObject.extend({
  key: null,
  validator() {},

  isRunning: readOnly("validate.isRunning"),

  validate: task(function*(changeset, newValue, oldValue, changes, content) {
    let validator = get(this, "validator");
    if (typeOf(validator) !== "function") {
      return true;
    }

    let result = yield validator({
      key: this.key,
      newValue,
      oldValue,
      changes,
      content,
    });
    result = isPresent(result) ? result : true;
    let isValid =
      result === true ||
      (isArray(result) && result.length === 1 && result[0] === true);

    // Error case.
    if (!isValid) {
      changeset.addError(this.key, { value: newValue, validation: result });
    }
  }).restartable(),
});

export default PropertyValidator;
