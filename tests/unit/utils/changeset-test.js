import { module, test } from "qunit";
import { setupTest } from "ember-qunit";
import EmberObject, { get } from "@ember/object";
import Changeset, { newChangeset } from "ember-concurrency-changeset";
import { isPresent, typeOf } from "@ember/utils";
import { resolve } from "rsvp";

let dummyValidations = {
  name(value) {
    return isPresent(value) && value.length > 3 || 'too short';
  },
  password(value) {
    return value || ['foo', 'bar'];
  },
  passwordConfirmation(newValue, _oldValue, { password: changedPassword }, { password }) {
    return isPresent(newValue) && (changedPassword === newValue || password === newValue) || "password doesn't match";
  },
  async(value) {
    return resolve(value);
  },
  options(value) {
    return isPresent(value);
  },
  org: {
    usa: {
      ny(value) {
        return isPresent(value) || "must be present";
      }
    }
  }
};

function dummyValidator({ key, newValue, oldValue, changes, content }) {
  let validatorFn = get(dummyValidations, key);

  if (typeOf(validatorFn) === 'function') {
    return validatorFn(newValue, oldValue, changes, content);
  }
}

module('Unit | Utility | changeset', function(hooks) {
  setupTest(hooks);

  let model;

  hooks.beforeEach(function() {
    model = EmberObject.create({});
  });

  test('it works via Changeset.create()', function(assert) {
    let result = Changeset.create({
      _content: model,
      _validator: dummyValidator,
      _validationMap: dummyValidations,
    });
    assert.ok(result);
  });

  test('it works via newChangeset', function(assert) {
    let result = newChangeset(model, dummyValidator, dummyValidations, {});
    assert.ok(result);
  });
  // obj,
  // validateFn,
  // validationMap,
  // options = defaultOptions
});
