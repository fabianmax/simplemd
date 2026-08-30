import "./styles.css";
import { createEditor } from "./editor/setup";

const app = document.querySelector<HTMLDivElement>("#app")!;
createEditor(app);
