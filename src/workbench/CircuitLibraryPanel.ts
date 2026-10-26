import {
  SoloStorage,
  upsertCircuit,
  exportCircuitLibrary,
  decodeCircuitLibrary,
} from "../storage/SoloStorage";
import type { CircuitEntry } from "../storage/SoloStorage";
import {
  decodeCircuitArchive,
  loadLastCircuit,
} from "../storage/CircuitStorage";
import type { CircuitArchive } from "../storage/CircuitStorage";
import { escapeHTML as esc, downloadJSON, textError } from "./ui";

function thumbnail(archive: CircuitArchive) {
  const points = archive.definition.controlPoints,
    minX = Math.min(...points.map((p) => p.x)),
    maxX = Math.max(...points.map((p) => p.x)),
    minZ = Math.min(...points.map((p) => p.z)),
    maxZ = Math.max(...points.map((p) => p.z)),
    scale = Math.min(
      190 / Math.max(1, maxX - minX),
      105 / Math.max(1, maxZ - minZ),
    );
  return [...points, points[0]]
    .map(
      (p) =>
        `${(110 - (p.x - (minX + maxX) / 2) * scale).toFixed(1)},${(65 - (p.z - (minZ + maxZ) / 2) * scale).toFixed(1)}`,
    )
    .join(" ");
}
export class CircuitLibraryPanel {
  readonly dialog: HTMLDialogElement;
  private entries: CircuitEntry[] = [];
  private selected = "";
  private current?: { archive: CircuitArchive; length: number };
  private abort = new AbortController();
  private busy = false;
  private disposed = false;
  constructor(
    root: HTMLElement,
    private storage: SoloStorage,
    private drive: (archive: CircuitArchive) => Promise<void>,
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.id = "circuit-library";
    this.dialog.className = "m6-dialog circuit-library-dialog";
    this.dialog.setAttribute("aria-labelledby", "circuit-library-title");
    this.dialog.innerHTML = `<header class="m6-dialog-header"><div><span class="eyebrow">CIRCUIT LIBRARY / LOCAL FAVOURITES</span><h2 id="circuit-library-title">Laps worth coming back to.</h2></div><button class="icon-button" data-library="close" aria-label="Close circuit library">×</button></header><div class="circuit-library-body"><aside><label for="library-name">CIRCUIT NAME</label><input id="library-name" maxlength="60" placeholder="Weekend circuit"/><button class="button save-button" data-library="save" id="library-save">Save active circuit</button><p id="library-current" class="m6-muted"></p><div class="garage-row"><button class="button subtle" data-library="rename">Rename selected</button><button class="button subtle" data-library="favourite">★ Favourite</button></div><button class="button save-button" data-library="drive" id="library-drive">Drive selected →</button><button class="button subtle" data-library="remove">Move to trash</button><button class="button subtle" data-library="restore">Restore selected</button><details class="m6-details"><summary>Import / export</summary><button class="button subtle" data-library="export-one">Export selected circuit</button><button class="button subtle" data-library="export-all">Export library</button><button class="button subtle" data-library="last">Add last M7 saved circuit</button><label for="library-file">Import circuit / library JSON</label><input id="library-file" type="file" accept=".json,application/json"/><label for="library-import">Or paste JSON</label><textarea id="library-import" spellcheck="false" placeholder="Paste a circuit or library export"></textarea><button class="button subtle" data-library="import">Import as saved circuits</button></details><p class="m6-muted">Accepted definitions preserve the exact route and variant. Loading revalidates the circuit and retains your car. Up to 24 active entries in 32 MiB, including recoverable trash.</p></aside><section><div class="library-filters"><label for="library-search">Search<input id="library-search" type="search" placeholder="Find a circuit"/></label><label for="library-filter">Show<select id="library-filter"><option value="all">All circuits</option><option value="favourites">Favourites</option><option value="trash">Trash</option></select></label><span id="library-capacity"></span></div><div id="library-entries" class="library-grid"></div></section></div><footer class="m6-dialog-footer"><p id="library-status" role="status">Save an active generated circuit or import a circuit JSON. The proving circuit remains built in.</p></footer>`;
    root.append(this.dialog);
    this.dialog.addEventListener("click", this.click, {
      signal: this.abort.signal,
    });
    this.dialog.addEventListener(
      "input",
      (e) => {
        if ((e.target as HTMLElement).id === "library-search") this.render();
      },
      { signal: this.abort.signal },
    );
    this.dialog.addEventListener("change", this.change, {
      signal: this.abort.signal,
    });
  }
  private node<T extends HTMLElement = HTMLElement>(id: string) {
    return this.dialog.querySelector<T>(`#${id}`)!;
  }
  setCurrent(archive: CircuitArchive | undefined, length: number) {
    this.current = archive ? { archive, length } : undefined;
  }
  async open() {
    this.dialog.showModal();
    this.status(
      "Choose a saved circuit, or save the active generated circuit.",
    );
    this.busy = true;
    try {
      this.entries = await this.storage.library();
      if (this.disposed) return;
      this.selected = this.entries.find((e) => !e.trashed)?.id ?? "";
      this.render();
    } catch (error) {
      this.status(textError(error));
    } finally {
      this.busy = false;
    }
  }
  status(message: string) {
    this.node("library-status").textContent = message;
  }
  private entry() {
    const e = this.entries.find((e) => e.id === this.selected);
    if (!e) throw new Error("Select a saved circuit first.");
    return e;
  }
  private async mutate(change: (entries: CircuitEntry[]) => CircuitEntry[]) {
    this.entries = await this.storage.changeLibrary(change);
    this.render();
  }
  private async import(raw: string) {
    if (raw.length > 40 * 1024 * 1024)
      throw new Error("Circuit/library import exceeds 40 MiB.");
    const data = JSON.parse(raw);
    const imported =
      data?.format === "procgen-racing/library"
        ? decodeCircuitLibrary(raw)
        : null;
    if (imported)
      await this.mutate((entries) => {
        let next = entries;
        for (const e of imported) {
          next = upsertCircuit(next, e.archive, e.name, e.length);
          next[0].favourite = e.favourite;
        }
        return next;
      });
    else {
      const archive = decodeCircuitArchive(raw),
        variant = archive.definition.familyDesign?.variants.find(
          (v) => v.id === archive.definition.familyDesign?.activeVariant,
        );
      const points = archive.definition.controlPoints,
        length =
          variant?.length ??
          points.reduce(
            (sum, p, i) =>
              sum +
              Math.hypot(
                p.x - points[(i + 1) % points.length].x,
                p.z - points[(i + 1) % points.length].z,
              ),
            0,
          );
      await this.mutate((entries) =>
        upsertCircuit(entries, archive, archive.definition.name, length),
      );
    }
    this.selected = this.entries[0]?.id ?? "";
    this.render();
    this.status(
      "Imported and checksum-checked. Drive revalidates the accepted geometry.",
    );
  }
  private click = async (event: Event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-library], [data-circuit-entry]",
    );
    if (!target) return;
    if (target.dataset.circuitEntry) {
      this.selected = target.dataset.circuitEntry;
      this.node<HTMLInputElement>("library-name").value = this.entry().name;
      this.render();
      return;
    }
    const action = target.dataset.library;
    if (action === "close") {
      this.dialog.close();
      return;
    }
    if (this.busy) return;
    this.busy = true;
    try {
      if (action === "save") {
        if (!this.current)
          throw new Error(
            "Load a generated circuit before saving it. The proving circuit is already built in.",
          );
        const current = this.current;
        await this.mutate((entries) =>
          upsertCircuit(
            entries,
            current.archive,
            this.node<HTMLInputElement>("library-name").value ||
              current.archive.definition.name,
            current.length,
          ),
        );
        this.selected = this.entries[0].id;
        this.render();
        this.status(
          "Active circuit saved, including its accepted route variant.",
        );
      } else if (action === "drive") {
        const e = this.entry();
        if (e.trashed)
          throw new Error("Restore this circuit from trash before driving it.");
        this.status("Revalidating and compiling the saved circuit…");
        await this.drive(e.archive);
        this.status(`${e.name} loaded. Your car and setup are retained.`);
        this.dialog.close();
      } else if (
        action === "rename" ||
        action === "favourite" ||
        action === "remove" ||
        action === "restore"
      ) {
        const e = this.entry(),
          name = this.node<HTMLInputElement>("library-name")
            .value.trim()
            .slice(0, 60);
        if (action === "rename" && !name)
          throw new Error("Enter a name for the selected circuit.");
        await this.mutate((entries) =>
          entries.map((item) =>
            item.id !== e.id
              ? item
              : {
                  ...item,
                  ...(action === "rename"
                    ? { name }
                    : action === "favourite"
                      ? { favourite: !item.favourite }
                      : { trashed: action === "remove" }),
                  updatedAt: new Date().toISOString(),
                },
          ),
        );
        this.status(
          action === "remove"
            ? "Moved to recoverable trash. Choose Show → Trash to restore it."
            : "Saved circuit updated.",
        );
      } else if (action === "export-one")
        downloadJSON(
          "procgen-circuit.json",
          JSON.stringify(this.entry().archive),
        );
      else if (action === "export-all")
        downloadJSON(
          "procgen-circuit-library.json",
          exportCircuitLibrary(this.entries),
        );
      else if (action === "import")
        await this.import(
          this.node<HTMLTextAreaElement>("library-import").value,
        );
      else if (action === "last") {
        const saved = await loadLastCircuit();
        if (!saved)
          throw new Error("No previous M7 circuit was saved in this browser.");
        await this.import(JSON.stringify(saved));
      }
    } catch (error) {
      this.status(textError(error));
    } finally {
      this.busy = false;
    }
  };
  private change = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.id === "library-filter") {
      this.render();
      return;
    }
    if (input.id !== "library-file" || !input.files?.[0] || this.busy) return;
    this.busy = true;
    try {
      if (input.files[0].size > 40 * 1024 * 1024)
        throw new Error("Library file exceeds 40 MiB.");
      await this.import(await input.files[0].text());
      input.value = "";
    } catch (error) {
      this.status(textError(error));
    } finally {
      this.busy = false;
    }
  };
  private render() {
    const filter = this.node<HTMLSelectElement>("library-filter").value,
      search =
        this.node<HTMLInputElement>("library-search").value.toLowerCase();
    const entries = this.entries
      .filter(
        (e) =>
          (filter === "trash" ? e.trashed : !e.trashed) &&
          (filter !== "favourites" || e.favourite) &&
          e.name.toLowerCase().includes(search),
      )
      .sort(
        (a, b) =>
          Number(b.favourite) - Number(a.favourite) ||
          b.updatedAt.localeCompare(a.updatedAt),
      );
    this.node("library-entries").innerHTML =
      entries
        .map(
          (e) =>
            `<button class="library-card ${e.id === this.selected ? "selected" : ""}" data-circuit-entry="${esc(e.id)}"><svg viewBox="0 0 220 130" aria-label="${esc(e.name)} route outline" role="img"><polyline points="${thumbnail(e.archive)}"/></svg><strong>${e.favourite ? "★ " : ""}${esc(e.name)}</strong><span>${esc(e.archive.recipe.family)} · ${(e.length / 1000).toFixed(2)} km · ${esc(e.archive.definition.familyDesign?.activeVariant ?? "full")}</span><small>${esc(e.archive.recipe.seed)} · ${e.trashed ? "In trash" : new Date(e.updatedAt).toLocaleDateString()}</small></button>`,
        )
        .join("") ||
      '<p class="library-empty">No circuits here yet. Save an active circuit or import a JSON export.</p>';
    this.node("library-capacity").textContent =
      `${this.entries.filter((e) => !e.trashed).length} / 24`;
    this.node<HTMLButtonElement>("library-save").disabled = !this.current;
    this.node("library-current").textContent = this.current
      ? `Active: ${this.current.archive.definition.name}`
      : "Proving circuit is built in. Generated circuits can be saved here.";
    this.node<HTMLButtonElement>("library-drive").disabled = !this.entries.some(
      (e) => e.id === this.selected && !e.trashed,
    );
  }
  dispose() {
    this.disposed = true;
    this.abort.abort();
    this.dialog.remove();
  }
}
