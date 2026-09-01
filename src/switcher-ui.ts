/** ⌘P overlay. Opens over the editor; type filters, ↑/↓ move, Enter opens,
 *  Esc closes. Non-modal to the file, modal to the keyboard while open. */
import { rankItems, type SwitchItem } from "./switcher";

export class SwitcherUI {
  private root: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private items: SwitchItem[] = [];
  private ranked: SwitchItem[] = [];
  private selected = 0;

  constructor(
    parent: HTMLElement,
    private onPick: (item: SwitchItem) => void,
    private onClose: () => void,
  ) {
    this.root = document.createElement("div");
    this.root.className = "switcher";
    this.root.hidden = true;
    const box = document.createElement("div");
    box.className = "switcher-box";
    this.input = document.createElement("input");
    this.input.placeholder = "Switch to…";
    this.input.spellcheck = false;
    this.list = document.createElement("div");
    this.list.className = "switcher-list";
    box.append(this.input, this.list);
    this.root.appendChild(box);
    parent.appendChild(this.root);

    this.input.oninput = () => {
      this.selected = 0;
      this.render();
    };
    this.input.onkeydown = (e) => {
      if (e.key === "Escape") this.close();
      else if (e.key === "Enter") this.pick(this.selected);
      else if (e.key === "ArrowDown") {
        this.selected = Math.min(this.selected + 1, this.ranked.length - 1);
        this.render();
      } else if (e.key === "ArrowUp") {
        this.selected = Math.max(this.selected - 1, 0);
        this.render();
      } else return;
      e.preventDefault();
    };
    this.root.onclick = (e) => {
      if (e.target === this.root) this.close();
    };
  }

  open(items: SwitchItem[]) {
    this.items = items;
    this.selected = 0;
    this.input.value = "";
    this.root.hidden = false;
    this.render();
    this.input.focus();
  }

  close() {
    this.root.hidden = true;
    this.onClose();
  }

  get isOpen() {
    return !this.root.hidden;
  }

  private pick(i: number) {
    const item = this.ranked[i];
    this.root.hidden = true;
    if (item) this.onPick(item);
    else this.onClose();
  }

  private render() {
    this.ranked = rankItems(this.items, this.input.value);
    this.list.replaceChildren(
      ...this.ranked.slice(0, 12).map((item, i) => {
        const row = document.createElement("div");
        row.className = "switcher-row" + (i === this.selected ? " switcher-selected" : "");
        const name = document.createElement("span");
        name.textContent = item.path.split("/").pop() ?? item.path;
        const hint = document.createElement("span");
        hint.className = "switcher-hint";
        hint.textContent = item.tabIndex >= 0 ? "open" : item.path;
        row.append(name, hint);
        row.onclick = () => this.pick(i);
        return row;
      }),
    );
  }
}
