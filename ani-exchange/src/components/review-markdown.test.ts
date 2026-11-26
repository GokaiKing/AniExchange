import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewMarkdown } from "./review-markdown";

const render = (text: string) => renderToStaticMarkup(createElement(ReviewMarkdown, { text }));

describe("ReviewMarkdown", () => {
  it("renderiza markdown básico", () => {
    const html = render("**genial** y _bonito_\n\n- uno\n- dos");
    expect(html).toContain("<strong>genial</strong>");
    expect(html).toContain("<em>bonito</em>");
    expect(html).toContain("<li>uno</li>");
  });

  it("no deja pasar HTML crudo ni imágenes", () => {
    const html = render('<script>alert(1)</script> hola <img src=x onerror="alert(1)"> ![x](https://x/y.png)');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
  });

  it("neutraliza links javascript: y abre los demás en pestaña nueva", () => {
    const html = render("[malo](javascript:alert(1)) [bueno](https://anilist.co)");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://anilist.co" target="_blank" rel="noreferrer nofollow"');
  });
});
