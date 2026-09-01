import "./styles.css";
import { App } from "./app";

const root = document.querySelector<HTMLDivElement>("#app")!;
const app = new App(root);
void app.init();
