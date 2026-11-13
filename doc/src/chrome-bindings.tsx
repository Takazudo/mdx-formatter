import { Island } from "@takazudo/zfb";
import { defineChromeBindings } from "@takazudo/zudo-doc/chrome-bindings";
import FormatterPlayground from "./components/formatter-playground";

// zfb's island scanner accepts a component-map wrapper only in this
// Fragment-wrapped fixed-target shape; a bare-return wrapper is rejected.
function FormatterPlaygroundIsland() {
  return (
    <>
      <Island when="load">
        <FormatterPlayground />
      </Island>
    </>
  );
}

export const chromeBindings = defineChromeBindings({
  mdxExtras: {
    FormatterPlayground: FormatterPlaygroundIsland,
  },
});
