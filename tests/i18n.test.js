import test from "node:test";
import assert from "node:assert/strict";

import { t, setLang } from "../src/ui/i18n.js";

test("i18n translates with the active language and falls back", () => {
  setLang("en");
  assert.equal(t("toolbar.save"), "Save");
  assert.equal(t("prop.multi", { n: 3 }), "3 parts selected");

  setLang("pt");
  assert.equal(t("toolbar.save"), "Salvar");
  assert.equal(t("vtab.balanced"), "Equilibrado");
  assert.equal(t("prop.multi", { n: 3 }), "3 peças selecionadas");

  assert.equal(t("does.not.exist"), "does.not.exist"); // missing key falls back to itself

  setLang("en"); // restore for any later assertions
});
