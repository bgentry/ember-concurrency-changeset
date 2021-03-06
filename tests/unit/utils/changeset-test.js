import { module, test } from "qunit";
import { setupTest } from "ember-qunit";
import EmberObject, { get, set, setProperties } from "@ember/object";
import Changeset, { newChangeset } from "ember-concurrency-changeset";
import { isPresent } from "@ember/utils";
import { resolve } from "rsvp";
import { run } from "@ember/runloop";
import { settled } from "ember-test-helpers";
import ObjectProxy from "@ember/object/proxy";

let dummyValidations = {
  name(value) {
    return (isPresent(value) && value.length > 3) || "too short";
  },
  password(value) {
    return value || ["foo", "bar"];
  },
  passwordConfirmation(
    newValue,
    _oldValue,
    { password: changedPassword, passwordConfirmation }
  ) {
    if (!changedPassword && !passwordConfirmation) {
      return true;
    }
    return changedPassword === passwordConfirmation || "password doesn't match";
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
      },
    },
  },
};

module("Unit | Utility | changeset", function(hooks) {
  setupTest(hooks);

  let model;

  hooks.beforeEach(function() {
    model = EmberObject.create({});
  });

  test("it works via Changeset.create()", async function(assert) {
    let result = Changeset.create({
      _content: model,
      _validationMap: dummyValidations,
    });
    assert.ok(result);
  });

  test("it works via newChangeset", async function(assert) {
    let result = newChangeset(model, dummyValidations, {});
    assert.ok(result);
  });

  test("content can be an empty hash", async function(assert) {
    assert.expect(1);

    let emptyObject = Object.create(null);
    let dummyChangeset = new Changeset(emptyObject, dummyValidations);

    assert.equal(dummyChangeset.toString(), "changeset:[object Object]");
  });

  /**
   * #error
   */

  test("#error returns the error object", async function(assert) {
    let dummyChangeset = newChangeset(model, dummyValidations);
    let expectedResult = { name: { validation: "too short", value: "a" } };
    run(() => dummyChangeset.set("name", "a"));
    await settled();

    assert.deepEqual(
      get(dummyChangeset, "error"),
      expectedResult,
      "should return error object"
    );
  });

  /**
   * #change
   */

  test("#change returns the changes object", async function(assert) {
    let dummyChangeset = newChangeset(model);
    let expectedResult = { name: "a" };
    run(() => dummyChangeset.set("name", "a"));

    assert.deepEqual(
      get(dummyChangeset, "change"),
      expectedResult,
      "should return changes object"
    );
  });

  /**
   * #isPristine
   */

  test("isPristine returns true if changes are equal to content's values", async function(assert) {
    let done = assert.async();
    model.set("name", "Bobby");
    model.set("thing", 123);
    model.set("nothing", null);

    let dummyChangeset = newChangeset(model, dummyValidations);
    run(() => {
      dummyChangeset.set("name", "Bobby");
      dummyChangeset.set("nothing", null);
    });

    assert.ok(dummyChangeset.get("isPristine"), "should be pristine");
    done();
  });

  test("isPristine returns false if changes are not equal to content's values", async function(assert) {
    let done = assert.async();

    model.set("name", "Bobby");
    let dummyChangeset = newChangeset(model, dummyValidations);
    run(() => {
      dummyChangeset.set("name", "Bobby");
      dummyChangeset.set("thing", 123);
    });

    assert.notOk(dummyChangeset.get("isPristine"), "should not be pristine");
    done();
  });

  test("isPristine works with `null` values", async function(assert) {
    model.set("name", null);
    model.set("age", 15);
    let dummyChangeset = newChangeset(model);

    assert.ok(dummyChangeset.get("isPristine"), "should be pristine");

    run(() => dummyChangeset.set("name", "Kenny"));
    assert.notOk(dummyChangeset.get("isPristine"), "should not be pristine");

    run(() => dummyChangeset.set("name", null));
    assert.ok(dummyChangeset.get("isPristine"), "should be pristine");
  });

  module("#get", function() {
    test("it proxies to content", async function(assert) {
      set(model, "name", "Jim Bob");
      let dummyChangeset = newChangeset(model);
      let result = get(dummyChangeset, "name");

      assert.equal(result, "Jim Bob", "should proxy to content");
    });

    test("it returns change if present", async function(assert) {
      let done = assert.async();
      set(model, "name", "Jim Bob");
      let dummyChangeset = newChangeset(model);
      run(() => {
        set(dummyChangeset, "name", "Milton Waddams");
        let result = get(dummyChangeset, "name");
        assert.equal(result, "Milton Waddams", "should proxy to change");
        done();
      });
    });

    test("it returns change that is a blank value", async function(assert) {
      let done = assert.async();
      set(model, "name", "Jim Bob");
      let dummyChangeset = newChangeset(model);
      run(() => {
        set(dummyChangeset, "name", "");
        let result = get(dummyChangeset, "name");
        assert.equal(result, "", "should proxy to change");
        done();
      });
    });

    test("nested objects will return correct values", async function(assert) {
      set(model, "org", {
        asia: { sg: "_initial" }, // for the sake of disambiguating nulls
        usa: {
          ca: null,
          ny: null,
          ma: { name: null },
        },
      });

      let dummyChangeset = newChangeset(model, dummyValidations);
      assert.equal(
        dummyChangeset.get("org.asia.sg"),
        "_initial",
        "returns initial value"
      );
      run(() => dummyChangeset.set("org.asia.sg", "sg"));
      assert.equal(
        dummyChangeset.get("org.asia.sg"),
        "sg",
        "returns newly set value"
      );
    });

    test("nested objects can contain arrays", async function(assert) {
      let done = assert.async();

      setProperties(model, {
        name: "Bob",
        contact: {
          emails: ["bob@email.com", "the_bob@email.com"],
        },
      });

      assert.deepEqual(
        model.get("contact.emails"),
        ["bob@email.com", "the_bob@email.com"],
        "returns initial model value"
      );
      let dummyChangeset = newChangeset(model, dummyValidations);
      assert.equal(
        dummyChangeset.get("name"),
        "Bob",
        "returns changeset initial value"
      );
      assert.deepEqual(
        dummyChangeset.get("contact.emails"),
        ["bob@email.com", "the_bob@email.com"],
        "returns changeset initial value"
      );
      run(() =>
        dummyChangeset.set("contact.emails", [
          "fred@email.com",
          "the_fred@email.com",
        ])
      );
      assert.deepEqual(
        dummyChangeset.get("contact.emails"),
        ["fred@email.com", "the_fred@email.com"],
        "returns changeset changed value"
      );

      dummyChangeset.rollback();
      assert.deepEqual(
        dummyChangeset.get("contact.emails"),
        ["bob@email.com", "the_bob@email.com"],
        "returns changeset rolledback value"
      );
      run(() =>
        dummyChangeset.set("contact.emails", [
          "fred@email.com",
          "the_fred@email.com",
        ])
      );
      assert.deepEqual(
        dummyChangeset.get("contact.emails"),
        ["fred@email.com", "the_fred@email.com"],
        "returns changeset changed value"
      );

      // dummyChangeset.execute();
      // assert.deepEqual(model.get('contact.emails'), [ 'fred@email.com', 'the_fred@email.com' ], 'returns model saved value');
      done();
    });

    test("returned Object proxies to underlying method", async function(assert) {
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
            dog: new Dog("shiba inu, wow"),
          },
        },
      };

      {
        let c = newChangeset(model);
        let actual = c.get("foo.bar.dog").bark();
        let expectedResult = "woof i'm a shiba inu, wow";
        assert.equal(
          actual,
          expectedResult,
          "should proxy to underlying method"
        );
      }

      {
        let c = newChangeset(model);
        let actual = get(c, "foo.bar.dog");
        let expectedResult = get(model, "foo.bar.dog");
        assert.notEqual(actual, expectedResult, "using Ember.get won't work");
      }

      {
        let c = newChangeset(model);
        let actual = get(c, "foo.bar.dog.content");
        let expectedResult = get(model, "foo.bar.dog");
        assert.equal(actual, expectedResult, "you have to use .content");
      }
    });
  });

  module("#set", function() {
    test("it adds a change if valid", async function(assert) {
      let expectedChanges = [{ key: "name", value: "foo" }];
      let dummyChangeset = newChangeset(model);
      run(() => dummyChangeset.set("name", "foo"));
      let changes = get(dummyChangeset, "changes");

      assert.deepEqual(changes, expectedChanges, "should add change");
    });

    test("it removes a change if set back to original value", async function(assert) {
      let model = EmberObject.create({ name: "foo" });
      let dummyChangeset = newChangeset(model);

      run(() => dummyChangeset.set("name", "bar"));
      assert.deepEqual(
        get(dummyChangeset, "changes"),
        [{ key: "name", value: "bar" }],
        "change is added when value is different than original value"
      );

      run(() => dummyChangeset.set("name", "foo"));
      assert.deepEqual(
        get(dummyChangeset, "changes"),
        [],
        "change is removed when new value matches original value"
      );
    });

    test("it removes a change if set back to original value when obj is ProxyObject", async function(assert) {
      let model = ObjectProxy.create({ content: { name: "foo" } });
      let dummyChangeset = newChangeset(model);

      run(() => dummyChangeset.set("name", "bar"));
      assert.deepEqual(
        get(dummyChangeset, "changes"),
        [{ key: "name", value: "bar" }],
        "change is added when value is different than original value"
      );

      run(() => dummyChangeset.set("name", "foo"));
      assert.deepEqual(
        get(dummyChangeset, "changes"),
        [],
        "change is removed when new value matches original value"
      );
    });

    test("it adds the change even if invalid", async function(assert) {
      let expectedErrors = [
        { key: "name", validation: "too short", value: "a" },
        { key: "password", validation: ["foo", "bar"], value: false },
      ];
      let expectedChanges = [
        { key: "name", value: "a" },
        { key: "password", value: false },
      ];
      let dummyChangeset = newChangeset(model, dummyValidations);
      run(() => {
        dummyChangeset.set("name", "a");
        dummyChangeset.set("password", false);
      });
      let changes = get(dummyChangeset, "changes");
      let errors = get(dummyChangeset, "errors");
      let isValid = get(dummyChangeset, "isValid");
      let isInvalid = get(dummyChangeset, "isInvalid");

      assert.deepEqual(changes, expectedChanges, "should not add change");
      assert.deepEqual(errors, expectedErrors, "should have errors");
      assert.notOk(isValid, "should not be valid");
      assert.ok(isInvalid, "should be invalid");
    });

    test("it adds the change without validation if `skipValidate` option is set", async function(assert) {
      let expectedChanges = [{ key: "password", value: false }];

      let dummyChangeset = newChangeset(model, dummyValidations, {
        skipValidate: true,
      });
      run(() => dummyChangeset.set("password", false));
      let changes = get(dummyChangeset, "changes");

      assert.deepEqual(changes, expectedChanges, "should add change");
    });

    test("it should remove nested changes when setting roots", async function(assert) {
      set(model, "org", {
        usa: {
          ny: "ny",
          ca: "ca",
        },
      });

      let c = newChangeset(model);
      run(() => {
        c.set("org.usa.ny", "foo");
        c.set("org.usa.ca", "bar");
        c.set("org", "no usa for you");
      });

      let actual = get(c, "changes");
      let expectedResult = [{ key: "org", value: "no usa for you" }];
      assert.deepEqual(actual, expectedResult, "removes nested changes");
    });

    test("it works with setProperties", async function(assert) {
      let dummyChangeset = newChangeset(model);
      let expectedResult = [
        { key: "firstName", value: "foo" },
        { key: "lastName", value: "bar" },
      ];
      run(() =>
        dummyChangeset.setProperties({ firstName: "foo", lastName: "bar" })
      );

      assert.deepEqual(
        get(dummyChangeset, "changes"),
        expectedResult,
        "precondition"
      );
    });

    test("it accepts async validations", async function(assert) {
      let done = assert.async();
      let dummyChangeset = newChangeset(model, dummyValidations);
      let expectedChanges = [{ key: "async", value: true }];
      let expectedError = {
        async: { validation: "is invalid", value: "is invalid" },
      };
      run(() => dummyChangeset.set("async", true));
      run(() =>
        assert.deepEqual(
          get(dummyChangeset, "changes"),
          expectedChanges,
          "should set change"
        )
      );
      run(() => dummyChangeset.set("async", "is invalid"));
      run(() => {
        assert.deepEqual(
          get(dummyChangeset, "error"),
          expectedError,
          "should set error"
        );
        done();
      });
    });

    test("it clears errors when setting to original value", async function(assert) {
      set(model, "name", "Jim Bob");
      let dummyChangeset = newChangeset(model, dummyValidations);
      run(() => dummyChangeset.set("name", ""));

      assert.ok(get(dummyChangeset, "isInvalid"), "should be invalid");
      run(() => dummyChangeset.set("name", "Jim Bob"));
      assert.ok(get(dummyChangeset, "isValid"), "should be valid");
      assert.notOk(get(dummyChangeset, "isInvalid"), "should be valid");
    });

    test("it should delete nested changes when equal", async function(assert) {
      set(model, "org", {
        usa: { ny: "i need a vacation" },
      });

      let c = newChangeset(model, dummyValidations);
      run(() => {
        c.set("org.usa.ny", "whoop");
        c.set("org.usa.ny", "i need a vacation");
      });

      let actual = get(c, "change.org.usa.ny");
      let expectedResult = undefined;
      assert.equal(actual, expectedResult, "should clear nested key");
    });

    test("it works when replacing an Object with an primitive", async function(assert) {
      let model = { foo: { bar: { baz: 42 } } };

      let c = newChangeset(model);
      assert.deepEqual(c.get("foo"), get(model, "foo"));

      run(() => c.set("foo", "not an object anymore"));
      // ember-changeset was originally testing that this equaled the original model's
      // 'foo' property, which doesn't seem right. It should be replaced by the new 'foo'
      // value string set above:
      assert.equal(c.get("foo"), "not an object anymore");
    });
  });

  module("#rollback", function() {
    test("restores old values", async function(assert) {
      let dummyChangeset = newChangeset(model, dummyValidations);
      let expectedChanges = [
        { key: "firstName", value: "foo" },
        { key: "lastName", value: "bar" },
        { key: "name", value: "" },
      ];
      let expectedErrors = [
        { key: "name", validation: "too short", value: "" },
      ];
      run(() => {
        dummyChangeset.set("firstName", "foo");
        dummyChangeset.set("lastName", "bar");
        dummyChangeset.set("name", "");
      });
      await settled();

      assert.deepEqual(
        get(dummyChangeset, "changes"),
        expectedChanges,
        "precondition"
      );
      assert.deepEqual(
        get(dummyChangeset, "errors"),
        expectedErrors,
        "precondition"
      );
      run(() => dummyChangeset.rollback());
      assert.deepEqual(get(dummyChangeset, "changes"), [], "should rollback");
      assert.deepEqual(get(dummyChangeset, "errors"), [], "should rollback");
    });

    test("resets valid state", async function(assert) {
      let dummyChangeset = newChangeset(model, dummyValidations);
      run(() => dummyChangeset.set("name", "a"));

      assert.ok(get(dummyChangeset, "isInvalid"), "should be invalid");
      run(() => dummyChangeset.rollback());
      assert.ok(get(dummyChangeset, "isValid"), "should be valid");
    });

    test("observing #rollback values", async function(assert) {
      let res;
      let changeset = newChangeset(model, dummyValidations);
      changeset.addObserver("name", function() {
        res = this.get("name");
      });
      assert.equal(undefined, changeset.get("name"), "initial value");
      run(() => changeset.set("name", "Jack"));
      assert.equal("Jack", res, "observer fired when setting value");
      run(() => changeset.rollback());
      assert.equal(
        undefined,
        res,
        "observer fired with the value name was rollback to"
      );
    });
  });

  module("#validate", function() {
    test("#validate/0 validates all fields immediately", async function(assert) {
      let done = assert.async();
      model.setProperties({ name: "J", password: false, options: null });
      let dummyChangeset = newChangeset(model, dummyValidations);

      run(() => {
        dummyChangeset.validate().then(() => {
          assert.deepEqual(
            get(dummyChangeset, "error.password"),
            { validation: ["foo", "bar"], value: false },
            "should validate immediately"
          );
          assert.deepEqual(
            get(dummyChangeset, "changes"),
            [],
            "should not set changes"
          );
          // errors on all fields except confirmation, because neither password
          // nor confirmaton have been set:
          assert.equal(
            get(dummyChangeset, "errors.length"),
            4,
            "should have 4 errors"
          );
          done();
        });
      });
    });

    test("#validate/1 validates a single field immediately", async function(assert) {
      let done = assert.async();
      model.setProperties({ name: "J", password: "123" });
      let dummyChangeset = newChangeset(model, dummyValidations);

      run(() => {
        dummyChangeset.validate("name").then(() => {
          assert.deepEqual(
            get(dummyChangeset, "error.name"),
            { validation: "too short", value: "J" },
            "should validate immediately"
          );
          assert.deepEqual(
            get(dummyChangeset, "changes"),
            [],
            "should not set changes"
          );
          assert.equal(
            get(dummyChangeset, "errors.length"),
            1,
            "should only have 1 error"
          );
          done();
        });
      });
    });

    test("it works correctly with changeset values", async function(assert) {
      let done = assert.async();
      model.setProperties({
        name: undefined,
        password: false,
        async: true,
        passwordConfirmation: false,
        options: {},
      });
      let dummyChangeset = newChangeset(model, dummyValidations);

      run(() => {
        dummyChangeset.set("name", "Jim Bob");
        dummyChangeset.validate().then(() => {
          assert.equal(
            get(dummyChangeset, "errors.length"),
            1,
            "should have 1 error"
          );
          assert.equal(get(dummyChangeset, "errors.0.key"), "password");
          assert.ok(get(dummyChangeset, "isInvalid"), "should be invalid");
        });
      });

      run(() => {
        dummyChangeset.set("passwordConfirmation", true);
        dummyChangeset.validate().then(() => {
          assert.equal(
            get(dummyChangeset, "errors.length"),
            2,
            "should have 2 errors"
          );
          assert.equal(get(dummyChangeset, "errors.0.key"), "password");
          assert.equal(
            get(dummyChangeset, "errors.1.key"),
            "passwordConfirmation"
          );
          assert.ok(get(dummyChangeset, "isInvalid"), "should be invalid");
        });
      });

      run(() => {
        dummyChangeset.set("password", true);
        dummyChangeset.set("passwordConfirmation", true);
        dummyChangeset.validate().then(() => {
          assert.equal(
            get(dummyChangeset, "errors.length"),
            0,
            "should have no errors"
          );
          assert.ok(get(dummyChangeset, "isValid"), "should be valid");
          done();
        });
      });
    });

    test("it works correctly with complex values", async function(assert) {
      let done = assert.async();
      model.setProperties({});
      let dummyChangeset = newChangeset(model, dummyValidations);

      run(() => {
        dummyChangeset.set("options", { persist: true });
        dummyChangeset.validate().then(() => {
          assert.deepEqual(get(dummyChangeset, "changes.0"), {
            key: "options",
            value: { persist: true },
          });
          done();
        });
      });
    });

    test("it marks all changes, even invalid ones", async function(assert) {
      let done = assert.async();
      model.setProperties({
        name: "Jim Bob",
        password: true,
        passwordConfirmation: true,
        async: true,
      });
      let dummyChangeset = newChangeset(model, dummyValidations);

      run(() => {
        dummyChangeset.set("name", "foo bar");
        dummyChangeset.set("password", false);

        dummyChangeset.validate().then(() => {
          assert.deepEqual(get(dummyChangeset, "changes"), [
            { key: "name", value: "foo bar" },
            { key: "password", value: false },
          ]);
          done();
        });
      });
    });

    test("it does not mark changes when nothing has changed", async function(assert) {
      let done = assert.async();
      let options = {
        persist: true,
        // test isEqual to ensure we're using Ember.isEqual for comparison
        isEqual(other) {
          return this.persist === get(other, "persist");
        },
      };
      model.setProperties({
        name: "Jim Bob",
        password: true,
        passwordConfirmation: true,
        async: true,
        options,
      });
      let dummyChangeset = newChangeset(model, dummyValidations);

      run(() => {
        dummyChangeset.set("options", options);
        dummyChangeset.validate().then(() => {
          assert.deepEqual(get(dummyChangeset, "error"), {});
          assert.deepEqual(get(dummyChangeset, "changes"), []);
          done();
        });
      });
    });

    test("it validates nested fields immediately", async function(assert) {
      let done = assert.async();
      set(model, "org", {
        usa: {
          ny: null,
        },
      });

      let dummyChangeset = newChangeset(model, dummyValidations);
      run(() => {
        dummyChangeset.validate("org.usa.ny").then(() => {
          assert.deepEqual(
            get(dummyChangeset, "error.org.usa.ny"),
            { validation: "must be present", value: null },
            "should validate immediately"
          );
          assert.deepEqual(
            get(dummyChangeset, "changes"),
            [],
            "should not set changes"
          );
          assert.equal(
            get(dummyChangeset, "errors.length"),
            1,
            "should only have 1 error"
          );
          done();
        });
      });
    });
  });

  module("#addError", function() {
    test("it adds an error to the changeset", async function(assert) {
      let dummyChangeset = newChangeset(model);
      dummyChangeset.addError("email", {
        value: "jim@bob.com",
        validation: "Email already taken",
      });

      assert.ok(get(dummyChangeset, "isInvalid"), "should be invalid");
      assert.equal(
        get(dummyChangeset, "error.email.validation"),
        "Email already taken",
        "should add the error"
      );
      run(() => dummyChangeset.set("email", "unique@email.com"));
      assert.ok(get(dummyChangeset, "isValid"), "should be valid");
    });

    test("it adds an error to the changeset using the shortcut", async function(assert) {
      let dummyChangeset = newChangeset(model);
      run(() => dummyChangeset.set("email", "jim@bob.com"));
      dummyChangeset.addError("email", "Email already taken");

      assert.ok(get(dummyChangeset, "isInvalid"), "should be invalid");
      assert.equal(
        get(dummyChangeset, "error.email.validation"),
        "Email already taken",
        "should add the error"
      );
      assert.equal(
        get(dummyChangeset, "error.email.value"),
        "jim@bob.com",
        "addError uses already present value"
      );
      run(() => dummyChangeset.set("email", "unique@email.com"));
      assert.ok(get(dummyChangeset, "isValid"), "should be valid");
    });
  });

  module("#pushErrors", function() {
    test("it pushes an error into an array of existing validations", async function(assert) {
      let dummyChangeset = newChangeset(model);
      run(() => dummyChangeset.set("email", "jim@bob.com"));
      dummyChangeset.addError("email", "Email already taken");
      dummyChangeset.pushErrors("email", "Invalid email format");

      assert.ok(get(dummyChangeset, "isInvalid"), "should be invalid");
      assert.deepEqual(
        get(dummyChangeset, "error.email.validation"),
        ["Email already taken", "Invalid email format"],
        "should push the error"
      );
      assert.equal(
        get(dummyChangeset, "error.email.value"),
        "jim@bob.com",
        "pushErrors uses already present value"
      );
      run(() => dummyChangeset.set("email", "unique@email.com"));
      assert.ok(get(dummyChangeset, "isValid"), "should be valid");
    });

    test("it pushes an error if no existing validations are present", async function(assert) {
      let dummyChangeset = newChangeset(model, dummyValidations);
      run(() => dummyChangeset.set("name", "J"));
      dummyChangeset.pushErrors("name", "cannot be J");

      assert.ok(get(dummyChangeset, "isInvalid"), "should be invalid");
      assert.deepEqual(
        get(dummyChangeset, "error.name.validation"),
        ["too short", "cannot be J"],
        "should push the error"
      );
      assert.equal(
        get(dummyChangeset, "error.name.value"),
        "J",
        "pushErrors uses already present value"
      );
      run(() => dummyChangeset.set("name", "Good name"));
      assert.ok(get(dummyChangeset, "isValid"), "should be valid");
    });
  });
});
