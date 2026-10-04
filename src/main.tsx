import { render } from "preact";
import { store } from "./app/store";
import "./styles.css";
import { App } from "./ui/App";

render(<App />, document.getElementById("app")!);
store.start();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(() => {
    /* ohne Offline-Unterstützung weiterarbeiten */
  });
}
