import EmberObject from "@ember/object";
import { readOnly } from "@ember/object/computed";
import { task } from "ember-concurrency";
import {
  isArray,
} from '@ember/array';

const PropertyValidator = EmberObject.extend({
  key: null,
  validator() {},

  isRunning: readOnly("validate.isRunning"),

  validate: task(function*(changeset, newValue, oldValue, changes, content) {
    console.log("changeset validating at start?", changeset.isValidating);
    let result = yield this.validator({
      key: this.key,
      newValue,
      oldValue,
      changes,
      content,
    });
    let isValid /* : boolean */ =
      result === true ||
      (isArray(result) && result.length === 1 && result[0] === true);
    console.log(
      `Validation result for ${this.key}, isValid=${isValid}`,
      result
    );

    // Error case.
    if (!isValid) {
      changeset.addError(this.key, { value: newValue, validation: result });
    }
  }).restartable(),
});

export default PropertyValidator;
