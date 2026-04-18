import lightUrl from "@assets/AeonikProTRIAL-Light_1776497579476.otf?url";
import lightItalicUrl from "@assets/AeonikProTRIAL-LightItalic_1776497579476.otf?url";
import regularItalicUrl from "@assets/AeonikProTRIAL-RegularItalic_1776497579477.otf?url";
import boldUrl from "@assets/AeonikProTRIAL-Bold_1776497579475.otf?url";
import boldItalicUrl from "@assets/AeonikProTRIAL-BoldItalic_1776497579476.otf?url";

const css = `
@font-face {
  font-family: "Aeonik Pro";
  font-weight: 300;
  font-style: normal;
  font-display: swap;
  src: url("${lightUrl}") format("opentype");
}
@font-face {
  font-family: "Aeonik Pro";
  font-weight: 300;
  font-style: italic;
  font-display: swap;
  src: url("${lightItalicUrl}") format("opentype");
}
@font-face {
  font-family: "Aeonik Pro";
  font-weight: 400;
  font-style: italic;
  font-display: swap;
  src: url("${regularItalicUrl}") format("opentype");
}
@font-face {
  font-family: "Aeonik Pro";
  font-weight: 700;
  font-style: normal;
  font-display: swap;
  src: url("${boldUrl}") format("opentype");
}
@font-face {
  font-family: "Aeonik Pro";
  font-weight: 700;
  font-style: italic;
  font-display: swap;
  src: url("${boldItalicUrl}") format("opentype");
}
`;

const style = document.createElement("style");
style.setAttribute("data-fonts", "aeonik-pro");
style.textContent = css;
document.head.appendChild(style);
