/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { Island } from "@takazudo/zfb";
import { defineChromeBindings } from "@takazudo/zudo-doc/chrome-bindings";
import FormatterPlayground from "./components/formatter-playground";

function FormatterPlaygroundIsland() {
  return Island({
    when: "load",
    children: <FormatterPlayground />,
  });
}

export const chromeBindings = defineChromeBindings({
  mdxExtras: {
    FormatterPlayground: FormatterPlaygroundIsland,
  },
});
