import "./style.css";
import "./workbench/m6.css";
import { App } from "./app/App";

const root = document.querySelector<HTMLElement>("#app")!;
const app = new App();
app.initialize(root).catch((error: unknown) => {
  console.error("Could not initialize the dynamics lab:", error);
  root.innerHTML =
    '<div class="boot-screen error-screen"><span>THE LAB COULD NOT START</span><h1>Let’s get you back on the pad.</h1><p id="startup-error"></p><button onclick="location.reload()">Reload the lab</button></div>';
  document.querySelector("#startup-error")!.textContent =
    error instanceof Error ? error.message : String(error);
});
if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
import "./workbench/first-pass.css";
