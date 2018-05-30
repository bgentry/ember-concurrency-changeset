import { module, test } from "qunit";
import { setupTest } from "ember-qunit";
import EmberObject, { get, set, setProperties } from "@ember/object";
import Changeset, { newChangeset } from "ember-concurrency-changeset";
import { isPresent, typeOf } from "@ember/utils";
import { resolve } from "rsvp";
import { run } from "@ember/runloop";
import { settled } from "ember-test-helpers";

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

  test('it works via Changeset.create()', async function(assert) {
    let result = Changeset.create({
      _content: model,
      _validator: dummyValidator,
      _validationMap: dummyValidations,
    });
    assert.ok(result);
  });

  test('it works via newChangeset', async function(assert) {
    let result = newChangeset(model, dummyValidator, dummyValidations, {});
    assert.ok(result);
  });

  test('content can be an empty hash', async function(assert) {
    assert.expect(1);

    let emptyObject = Object.create(null);
    let dummyChangeset = new Changeset(emptyObject, dummyValidator);

    assert.equal(dummyChangeset.toString(), 'changeset:[object Object]');
  });

  /**
   * #error
   */

  test('#error returns the error object', async function(assert) {
    let dummyChangeset = newChangeset(model, dummyValidator);
    let expectedResult = { name: { validation: 'too short', value: 'a' } };
    run(() => dummyChangeset.set('name', 'a'));
    await settled();

    assert.deepEqual(get(dummyChangeset, 'error'), expectedResult, 'should return error object');
  });

  /**
   * #change
   */

  test('#change returns the changes object', async function(assert) {
    let dummyChangeset = newChangeset(model);
    let expectedResult = { name: 'a' };
    run(() => dummyChangeset.set('name', 'a'));

    assert.deepEqual(get(dummyChangeset, 'change'), expectedResult, 'should return changes object');
  });

  /**
   * #isPristine
   */

  test("isPristine returns true if changes are equal to content's values", function(assert) {
    let done = assert.async();
    model.set('name', 'Bobby');
    model.set('thing', 123);
    model.set('nothing', null);

    let dummyChangeset = newChangeset(model, dummyValidator);
    run(() => {
      dummyChangeset.set('name', 'Bobby');
      dummyChangeset.set('nothing', null);
    });

    assert.ok(dummyChangeset.get('isPristine'), 'should be pristine');
    done();
  });

  test("isPristine returns false if changes are not equal to content's values", function(assert) {
    let done = assert.async();

    model.set('name', 'Bobby');
    let dummyChangeset = newChangeset(model, dummyValidator);
    run(() => {
      dummyChangeset.set('name', 'Bobby');
      dummyChangeset.set('thing', 123);
    });

    assert.notOk(dummyChangeset.get('isPristine'), 'should not be pristine');
    done();
  });

  test('isPristine works with `null` values', function(assert) {
    model.set('name', null);
    model.set('age', 15);
    let dummyChangeset = newChangeset(model);

    assert.ok(dummyChangeset.get('isPristine'), 'should be pristine');

    run(() => dummyChangeset.set('name', 'Kenny'));
    assert.notOk(dummyChangeset.get('isPristine'), 'should not be pristine');

    run(() => dummyChangeset.set('name', null));
    assert.ok(dummyChangeset.get('isPristine'), 'should be pristine');
  });

  module("#get", function() {
    test('it proxies to content', function(assert) {
      set(model, 'name', 'Jim Bob');
      let dummyChangeset = newChangeset(model);
      let result = get(dummyChangeset, 'name');

      assert.equal(result, 'Jim Bob', 'should proxy to content');
    });

    test('it returns change if present', function(assert) {
      let done = assert.async();
      set(model, 'name', 'Jim Bob');
      let dummyChangeset = newChangeset(model);
      run(() => {
        set(dummyChangeset, 'name', 'Milton Waddams');
        let result = get(dummyChangeset, 'name');
        assert.equal(result, 'Milton Waddams', 'should proxy to change');
        done();
      });
    });

    test('it returns change that is a blank value', function(assert) {
      let done = assert.async();
      set(model, 'name', 'Jim Bob');
      let dummyChangeset = newChangeset(model);
      run(() => {
        set(dummyChangeset, 'name', '');
        let result = get(dummyChangeset, 'name');
        assert.equal(result, '', 'should proxy to change');
        done();
      });
    });

    test('nested objects will return correct values', function(assert) {
      set(model, 'org', {
        asia: { sg: '_initial' },  // for the sake of disambiguating nulls
        usa: {
          ca: null,
          ny: null,
          ma: { name: null }
        }
      });

      let dummyChangeset = newChangeset(model, dummyValidator);
      assert.equal(dummyChangeset.get('org.asia.sg'), '_initial', 'returns initial value');
      run(() => dummyChangeset.set('org.asia.sg', 'sg'));
      assert.equal(dummyChangeset.get('org.asia.sg'), 'sg', 'returns newly set value');
    });

    test('nested objects can contain arrays', function(assert) {
      let done = assert.async();

      setProperties(model, {
        name: 'Bob',
        contact: {
          emails: [ 'bob@email.com', 'the_bob@email.com' ]
        }
      });

      assert.deepEqual(model.get('contact.emails'), [ 'bob@email.com', 'the_bob@email.com' ], 'returns initial model value');
      let dummyChangeset = newChangeset(model, dummyValidator);
      assert.equal(dummyChangeset.get('name'), 'Bob', 'returns changeset initial value');
      assert.deepEqual(dummyChangeset.get('contact.emails'), [ 'bob@email.com', 'the_bob@email.com' ], 'returns changeset initial value');
      run(() => dummyChangeset.set('contact.emails', [ 'fred@email.com', 'the_fred@email.com' ]));
      assert.deepEqual(dummyChangeset.get('contact.emails'), [ 'fred@email.com', 'the_fred@email.com' ], 'returns changeset changed value');

      dummyChangeset.rollback();
      assert.deepEqual(dummyChangeset.get('contact.emails'), [ 'bob@email.com', 'the_bob@email.com' ], 'returns changeset rolledback value');
      run(() => dummyChangeset.set('contact.emails', [ 'fred@email.com', 'the_fred@email.com' ]));
      assert.deepEqual(dummyChangeset.get('contact.emails'), [ 'fred@email.com', 'the_fred@email.com' ], 'returns changeset changed value');

      // dummyChangeset.execute();
      // assert.deepEqual(model.get('contact.emails'), [ 'fred@email.com', 'the_fred@email.com' ], 'returns model saved value');
      done();
    });

    test('returned Object proxies to underlying method', function(assert) {
      class Dog {
        constructor(b) {
          this.breed = b;
        }

        bark() {
          return `woof i'm a ${this.breed}`;
        }
      }

      let model = {
        foo: {
          bar: {
            dog: new Dog('shiba inu, wow')
          }
        }
      };

      {
        let c = newChangeset(model);
        let actual = c.get('foo.bar.dog').bark();
        let expectedResult = "woof i'm a shiba inu, wow";
        assert.equal(actual, expectedResult, 'should proxy to underlying method');
      }

      {
        let c = newChangeset(model);
        let actual = get(c, 'foo.bar.dog');
        let expectedResult = get(model, 'foo.bar.dog');
        assert.notEqual(actual, expectedResult, "using Ember.get won't work");
      }

      {
        let c = newChangeset(model);
        let actual = get(c, 'foo.bar.dog.content');
        let expectedResult = get(model, 'foo.bar.dog');
        assert.equal(actual, expectedResult, "you have to use .content");
      }
    });
  });
});
