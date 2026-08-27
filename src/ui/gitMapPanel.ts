import * as vscode from "vscode";
import { renderOverviewHtml } from "./overviewHtmlRenderer";
import { createOverviewPresentation } from "./overviewPresentation";
import { type RepositoryStateSnapshot, RepositoryStateSnapshotStore } from "./repositoryStateSnapshot";

const GIT_MAP_PANEL_VIEW_TYPE = "gitBearings.gitMap";

export class GitMapPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly snapshotStore: RepositoryStateSnapshotStore) {
    this.disposables.push(snapshotStore.onDidChange(() => this.render()));
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      GIT_MAP_PANEL_VIEW_TYPE,
      "Git Bearings: Git Map（UX試作）",
      vscode.ViewColumn.Beside,
      { enableScripts: false },
    );

    this.panel = panel;
    this.render();
    this.disposables.push(
      panel.onDidDispose(() => {
        if (this.panel === panel) {
          this.panel = undefined;
        }
      }),
    );
  }

  dispose(): void {
    this.panel?.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private render(): void {
    if (this.panel) this.panel.webview.html = createGitMapHtml(this.panel.webview, this.snapshotStore.current);
  }
}

function createGitMapHtml(webview: vscode.Webview, snapshot: RepositoryStateSnapshot): string {
  const nonce = createNonce();
  const overview = renderOverviewHtml(createOverviewPresentation(snapshot));

  return /* html */ `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Git Bearings: Git Map</title>
    <style nonce="${nonce}">
      :root { color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
      body { margin: 0; padding: 16px; }
      h1, h2, h3, p { margin-top: 0; }
      h1 { font-size: 1.2em; margin-bottom: 6px; }
      h2 { font-size: 0.92em; letter-spacing: 0.08em; }
      h3 { font-size: 0.86em; margin-bottom: 8px; }
      .fixture-note { color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
      .controls { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-bottom: 12px; padding: 6px 0; color: var(--vscode-descriptionForeground); font-size: 0.84em; }
      .control-group { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
      .control-group strong { font-size: 0.9em; }
      .control-group label { cursor: pointer; }
      .control-group label::before { content: "○"; margin-right: 3px; }
      .control-input { position: absolute; opacity: 0; pointer-events: none; }
      .compact-prototype, .continuous-prototype { display: none; }
      .prototype-layout { display: grid; grid-template-columns: minmax(620px, 1fr) minmax(220px, 0.32fr); gap: 16px; min-width: 0; }
      .prototype-layout.wide-prototype { display: none; }
      .map-area, .detail-pane { border: 1px solid var(--vscode-panel-border); border-radius: 5px; padding: 14px; min-width: 0; }
      .b-layout { display: grid; grid-template-columns: minmax(135px, 0.25fr) minmax(420px, 1fr) minmax(130px, 0.24fr); gap: 12px; align-items: stretch; }
      .region { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 11px; min-width: 0; }
      .changes { display: grid; grid-template-rows: auto 1fr auto 1fr; gap: 8px; }
      .flow-down { text-align: center; font-weight: 700; color: var(--vscode-descriptionForeground); }
      .change-card, .remote-card { border: 1px dashed var(--vscode-panel-border); border-radius: 4px; padding: 9px; }
      .change-card p, .remote-card p { color: var(--vscode-descriptionForeground); font-size: 0.86em; margin-bottom: 0; }
      .local { overflow: hidden; }
      .local > p { color: var(--vscode-descriptionForeground); font-size: 0.86em; }
      .graph-scroll { overflow-x: auto; padding-bottom: 3px; }
      .graph-fixture { display: none; min-width: 560px; }
      .graph-fixture svg { display: block; width: 100%; min-width: 560px; height: 255px; }
      .graph-line { fill: none; stroke: var(--vscode-foreground); stroke-width: 2.25; }
      .graph-line-muted { fill: none; stroke: var(--vscode-descriptionForeground); stroke-width: 2; stroke-dasharray: 5 4; }
      .commit { fill: var(--vscode-editor-background); stroke: var(--vscode-foreground); stroke-width: 2.5; }
      .commit-text, .pointer-text, .branch-text, .graph-caption { fill: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: 12px; }
      .graph-caption { fill: var(--vscode-descriptionForeground); font-size: 11px; }
      .branch-label { fill: var(--vscode-badge-background); stroke: var(--vscode-foreground); stroke-width: 1; }
      .head-label { fill: var(--vscode-editorWidget-background); stroke: var(--vscode-foreground); stroke-width: 1; }
      .pointer-line { fill: none; stroke: var(--vscode-foreground); stroke-width: 1.6; }
      .new-commit, .preview-flow, .preview-only { display: none; }
      .new-commit circle { fill: var(--vscode-editor-background); stroke: var(--vscode-focusBorder); stroke-width: 3; stroke-dasharray: 4 3; }
      .new-commit text { fill: var(--vscode-focusBorder); font-weight: 700; }
      .detail-preview { display: none; }
      .detail-normal { display: block; }
      .detail-pane p { color: var(--vscode-descriptionForeground); }
      .detail-list { padding-left: 18px; margin: 0; }
      .detail-list li { margin-bottom: 8px; }
      .legend { display: flex; flex-wrap: wrap; gap: 10px; font-size: 0.84em; color: var(--vscode-descriptionForeground); margin-top: 12px; }
      .legend-item { display: inline-flex; align-items: center; gap: 5px; }
      .legend-node { width: 10px; height: 10px; border: 2px solid var(--vscode-foreground); border-radius: 50%; }
      .legend-line { width: 18px; border-top: 2px solid var(--vscode-foreground); }
      .preview-banner { display: none; margin: 0 0 12px; padding: 9px; border-left: 3px solid var(--vscode-focusBorder); background: var(--vscode-textBlockQuote-background); }
      .compact-prototype { max-width: 460px; border: 1px solid var(--vscode-panel-border); border-radius: 5px; padding: 14px; }
      .compact-status { display: flex; justify-content: space-between; gap: 12px; padding-bottom: 9px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 0.9em; }
      .compact-status span { color: var(--vscode-descriptionForeground); }
      .compact-section { padding: 12px 0; border-bottom: 1px solid var(--vscode-panel-border); }
      .compact-section h2 { margin-bottom: 7px; }
      .compact-row { display: flex; justify-content: space-between; gap: 12px; font-size: 0.9em; }
      .compact-muted { color: var(--vscode-descriptionForeground); }
      .compact-flow { margin: 8px 0; color: var(--vscode-descriptionForeground); font-weight: 700; }
      .compact-staging { padding: 6px 8px; border-left: 2px solid var(--vscode-panel-border); }
      .compact-preview-flow { display: none; margin: 9px 0 0 24px; color: var(--vscode-focusBorder); font-weight: 700; }
      .compact-graph { display: none; }
      .compact-graph svg { display: block; width: 100%; height: auto; }
      .compact-detail { color: var(--vscode-descriptionForeground); font-size: 0.88em; margin: 0; }
      .continuous-prototype { max-width: 460px; padding: 4px 2px; }
      .continuous-header { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0 11px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 0.9em; }
      .continuous-header span, .continuous-secondary { color: var(--vscode-descriptionForeground); }
      .continuous-label { margin: 14px 0 7px; color: var(--vscode-descriptionForeground); font-size: 0.76em; font-weight: 700; letter-spacing: 0.08em; }
      .continuous-row { display: flex; justify-content: space-between; gap: 12px; font-size: 0.92em; }
      .continuous-flow { margin: 5px 0 5px 22px; color: var(--vscode-descriptionForeground); font-weight: 700; }
      .continuous-staging { padding-left: 8px; border-left: 2px solid var(--vscode-panel-border); }
      .continuous-graph { display: none; margin: 5px 0 2px; }
      .continuous-graph svg { display: block; width: 100%; height: auto; }
      .continuous-graph .commit { stroke-width: 3.5; }
      .continuous-graph .graph-line { stroke-width: 3; }
      .continuous-graph .pointer-line { stroke-width: 2.2; }
      .continuous-graph .branch-text { font-size: 14px; font-weight: 700; }
      .continuous-graph .pointer-text { font-size: 13px; font-weight: 700; }
      .continuous-graph .graph-caption { font-size: 11px; }
      .continuous-detail { margin-top: 12px; color: var(--vscode-descriptionForeground); font-size: 0.86em; }
      .continuous-detail summary { cursor: pointer; }
      .continuous-detail p { margin: 7px 0 0; }
      .overview { color: var(--vscode-foreground); }
      .overview-repository { color: var(--vscode-descriptionForeground); font-size: 0.82em; overflow-wrap: anywhere; }
      .overview-message, .overview-meaning { color: var(--vscode-descriptionForeground); }
      .overview-operation { border-left: 3px solid var(--vscode-notificationsWarningIcon-foreground); padding-left: 8px; font-weight: 700; }
      .overview-section { border-top: 1px solid var(--vscode-panel-border); padding: 10px 0; }
      .overview-section h3 { margin: 0 0 7px; }
      .overview-section dl { margin: 0; }
      .overview-section dl div { display: grid; grid-template-columns: minmax(86px, auto) minmax(0, 1fr); gap: 8px; margin: 3px 0; }
      .overview-section dt { color: var(--vscode-descriptionForeground); }
      .overview-section dd { margin: 0; overflow-wrap: anywhere; }
      #layout-wide:checked ~ .wide-prototype { display: grid; }
      #layout-compact:checked ~ .compact-prototype { display: block; }
      #layout-continuous:checked ~ .continuous-prototype { display: block; }
      #fixture-linear:checked ~ .wide-prototype .linear,
      #fixture-branch:checked ~ .wide-prototype .branch,
      #fixture-diverged:checked ~ .wide-prototype .diverged,
      #fixture-linear:checked ~ .compact-prototype .compact-linear,
      #fixture-branch:checked ~ .compact-prototype .compact-branch,
      #fixture-diverged:checked ~ .compact-prototype .compact-diverged,
      #fixture-linear:checked ~ .continuous-prototype .continuous-linear,
      #fixture-branch:checked ~ .continuous-prototype .continuous-branch,
      #fixture-diverged:checked ~ .continuous-prototype .continuous-diverged { display: block; }
      #layout-wide:checked ~ .controls label[for="layout-wide"]::before,
      #layout-compact:checked ~ .controls label[for="layout-compact"]::before,
      #layout-continuous:checked ~ .controls label[for="layout-continuous"]::before,
      #fixture-linear:checked ~ .controls label[for="fixture-linear"]::before,
      #fixture-branch:checked ~ .controls label[for="fixture-branch"]::before,
      #fixture-diverged:checked ~ .controls label[for="fixture-diverged"]::before,
      #state-normal:checked ~ .controls label[for="state-normal"]::before,
      #state-preview:checked ~ .controls label[for="state-preview"]::before { content: "◉"; color: var(--vscode-focusBorder); }
      #state-preview:checked ~ .wide-prototype .preview-only,
      #state-preview:checked ~ .wide-prototype .new-commit,
      #state-preview:checked ~ .wide-prototype .preview-flow,
      #state-preview:checked ~ .wide-prototype .preview-banner,
      #state-preview:checked ~ .wide-prototype .detail-preview,
      #state-preview:checked ~ .compact-prototype .new-commit,
      #state-preview:checked ~ .compact-prototype .preview-flow,
      #state-preview:checked ~ .compact-prototype .compact-preview-flow,
      #state-preview:checked ~ .compact-prototype .detail-preview { display: block; }
      #state-preview:checked ~ .continuous-prototype .new-commit,
      #state-preview:checked ~ .continuous-prototype .preview-flow,
      #state-preview:checked ~ .continuous-prototype .detail-preview { display: block; }
      #state-preview:checked ~ .wide-prototype .detail-normal,
      #state-preview:checked ~ .compact-prototype .detail-normal,
      #state-preview:checked ~ .continuous-prototype .detail-normal { display: none; }
      #state-preview:checked ~ .wide-prototype .staging,
      #state-preview:checked ~ .compact-prototype .compact-staging,
      #state-preview:checked ~ .continuous-prototype .continuous-staging { border-style: solid; border-color: var(--vscode-focusBorder); animation: pulse 1.6s ease-in-out infinite; }
      #state-preview:checked ~ .wide-prototype .branch-current,
      #state-preview:checked ~ .compact-prototype .branch-current,
      #state-preview:checked ~ .continuous-prototype .branch-current { display: none; }
      #state-preview:checked ~ .wide-prototype .branch-preview,
      #state-preview:checked ~ .compact-prototype .branch-preview,
      #state-preview:checked ~ .continuous-prototype .branch-preview { display: block; }
      #state-preview:checked ~ .continuous-prototype .commit,
      #state-preview:checked ~ .continuous-prototype .graph-line-muted { opacity: 0.52; }
      #state-preview:checked ~ .continuous-prototype .new-commit circle { animation: new-commit-arrive 900ms ease-out 1 both; stroke-width: 4; transform-box: fill-box; transform-origin: center; }
      .branch-preview { display: none; }
      @keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 transparent; } 50% { box-shadow: 0 0 0 4px var(--vscode-focusBorder); } }
      @keyframes new-commit-arrive { 0% { opacity: 0; transform: scale(0.72); } 55% { opacity: 1; transform: scale(1.16); } 100% { opacity: 1; transform: scale(1); } }
      @media (max-width: 900px) { .prototype-layout { grid-template-columns: 1fr; } .detail-pane { min-height: 150px; } }
    </style>
  </head>
  <body>
    <h1>Git Bearings: Git Map</h1>
    <p class="fixture-note">UX Gate用の静的fixtureです。実際のRepository状態・Git操作・Previewは表示していません。</p>

    <input class="control-input" id="layout-wide" type="radio" name="layout" />
    <input class="control-input" id="layout-compact" type="radio" name="layout" />
    <input class="control-input" id="layout-continuous" type="radio" name="layout" checked />
    <input class="control-input" id="fixture-linear" type="radio" name="fixture" checked />
    <input class="control-input" id="fixture-branch" type="radio" name="fixture" />
    <input class="control-input" id="fixture-diverged" type="radio" name="fixture" />
    <input class="control-input" id="state-normal" type="radio" name="state" checked />
    <input class="control-input" id="state-preview" type="radio" name="state" />

    <section class="controls" aria-label="fixture controls">
      <div class="control-group">
        <strong>prototype</strong>
        <label for="layout-wide">B' / Wide</label>
        <label for="layout-compact">Compact Vertical</label>
        <label for="layout-continuous">Compact Continuous</label>
      </div>
      <div class="control-group">
        <strong>履歴fixture</strong>
        <label for="fixture-linear">直線</label>
        <label for="fixture-branch">分岐</label>
        <label for="fixture-diverged">両側進行</label>
      </div>
      <div class="control-group">
        <strong>状態変化demo</strong>
        <label for="state-normal">通常</label>
        <label for="state-preview">git commit 相当のPreview</label>
      </div>
    </section>

    <main class="prototype-layout wide-prototype">
      <section class="map-area" aria-label="Git Map fixture">
        <p class="preview-banner"><strong>Preview（fixture）:</strong> Staging の変更から NEW COMMIT を生成し、main と HEAD が右へ移る表現です。実際のGit状態は変わりません。</p>
        <div class="b-layout">
          <section class="region changes" aria-label="Your changes">
            <h2>YOUR CHANGES</h2>
            <div class="change-card">
              <h3>Working Tree</h3>
              <p>2 files changed<br />fixture only</p>
            </div>
            <div class="flow-down" aria-label="Working Tree to Staging">↓</div>
            <div class="change-card staging">
              <h3>Staging</h3>
              <p>1 change ready<br /><span class="preview-only">→ NEW COMMIT</span></p>
            </div>
          </section>

          <section class="region local" aria-label="Local repository commit graph">
            <h2>LOCAL REPOSITORY</h2>
            <p>old → new。丸はcommit、線はparent relation、labelはcommitを指します。</p>
            <div class="graph-scroll">${createGraphFixtures()}</div>
            <div class="legend" aria-label="Graph legend">
              <span class="legend-item"><span class="legend-node"></span> commit</span>
              <span class="legend-item"><span class="legend-line"></span> parent relation</span>
              <span class="legend-item">HEAD → branch → commit</span>
            </div>
          </section>

          <section class="region" aria-label="Remote fixture">
            <h2>REMOTE</h2>
            <div class="remote-card">
              <h3>origin/main</h3>
              <p>remote reference<br />fixture only</p>
            </div>
          </section>
        </div>
      </section>

      <aside class="detail-pane" aria-label="Overview Detail">
        <h2>DETAIL PANE</h2>
        ${overview}
      </aside>
    </main>

    <main class="compact-prototype" aria-label="Compact Vertical Git Map fixture">
      <header class="compact-status">
        <strong>main / HEAD</strong>
        <span>2 changed / 1 staged</span>
      </header>
      <section class="compact-section">
        <h2>YOUR CHANGES</h2>
        <div class="compact-row"><strong>Working Tree</strong><span class="compact-muted">2 files</span></div>
        <div class="compact-flow">↓</div>
        <div class="compact-row compact-staging"><strong>Staging</strong><span class="compact-muted">1 change</span></div>
        <p class="compact-preview-flow">└────▶ ◌ NEW COMMIT</p>
      </section>
      <section class="compact-section">
        <h2>LOCAL REPOSITORY</h2>
        ${createCompactGraphFixtures()}
      </section>
      <section class="compact-section">
        <h2>REMOTE</h2>
        <p class="compact-detail">origin/main <span class="compact-muted">— fixture</span></p>
      </section>
      <section class="compact-section">
        <h2>DETAIL</h2>
        ${overview}
      </section>
    </main>

    <main class="continuous-prototype" aria-label="Compact Continuous Git Map fixture">
      <header class="continuous-header">
        <strong>main / HEAD</strong>
        <span>2 changed · 1 staged</span>
      </header>
      <p class="continuous-label">YOUR CHANGES</p>
      <div class="continuous-row"><strong>Working Tree</strong><span class="continuous-secondary">2 files</span></div>
      <div class="continuous-flow">↓</div>
      <div class="continuous-row continuous-staging"><strong>Staging</strong><span class="continuous-secondary">1 change</span></div>
      ${createContinuousGraphFixtures()}
      <details class="continuous-detail">
        <summary>Overview</summary>
        ${overview}
      </details>
    </main>
  </body>
</html>`;
}

function createGraphFixtures(): string {
  return /* html */ `
    <div class="graph-fixture linear">${createGraphSvg("linear", "直線履歴のfixture")}</div>
    <div class="graph-fixture branch">${createGraphSvg("branch", "branch分岐のfixture")}</div>
    <div class="graph-fixture diverged">${createGraphSvg("diverged", "両側進行のfixture")}</div>`;
}

function createCompactGraphFixtures(): string {
  return /* html */ `
    <div class="compact-graph compact-linear">${createCompactGraphSvg("linear", "直線履歴のCompact fixture")}</div>
    <div class="compact-graph compact-branch">${createCompactGraphSvg("branch", "分岐履歴のCompact fixture")}</div>
    <div class="compact-graph compact-diverged">${createCompactGraphSvg("diverged", "両側進行のCompact fixture")}</div>`;
}

function createContinuousGraphFixtures(): string {
  return /* html */ `
    <div class="continuous-graph continuous-linear">${createContinuousGraphSvg("linear", "直線履歴のContinuous fixture")}</div>
    <div class="continuous-graph continuous-branch">${createContinuousGraphSvg("branch", "分岐履歴のContinuous fixture")}</div>
    <div class="continuous-graph continuous-diverged">${createContinuousGraphSvg("diverged", "両側進行のContinuous fixture")}</div>`;
}

function createContinuousGraphSvg(
  kind: "linear" | "branch" | "diverged",
  label: string,
): string {
  const relations = {
    linear: `<path class="graph-line" d="M64 106 H164 M184 106 H284" />`,
    branch: `<path class="graph-line" d="M64 112 H158 C184 112 190 72 232 72 H284" /><path class="graph-line" d="M64 112 H158 C184 112 190 146 232 146 H284" />`,
    diverged: `<path class="graph-line" d="M64 106 H158 C184 106 190 70 232 70 H284" /><path class="graph-line" d="M64 106 H158 C184 106 190 142 232 142 H284" />`,
  }[kind];
  const nodes = {
    linear: `<circle class="commit" cx="54" cy="106" r="11" /><circle class="commit" cx="174" cy="106" r="11" /><circle class="commit" cx="294" cy="106" r="11" />`,
    branch: `<circle class="commit" cx="54" cy="112" r="11" /><circle class="commit" cx="168" cy="112" r="11" /><circle class="commit" cx="242" cy="72" r="11" /><circle class="commit" cx="294" cy="72" r="11" /><circle class="commit" cx="242" cy="146" r="11" /><circle class="commit" cx="294" cy="146" r="11" />`,
    diverged: `<circle class="commit" cx="54" cy="106" r="11" /><circle class="commit" cx="168" cy="106" r="11" /><circle class="commit" cx="242" cy="70" r="11" /><circle class="commit" cx="294" cy="70" r="11" /><circle class="commit" cx="242" cy="142" r="11" /><circle class="commit" cx="294" cy="142" r="11" />`,
  }[kind];
  const targetY = kind === "linear" ? 106 : kind === "branch" ? 72 : 70;

  return /* html */ `<svg viewBox="0 0 420 190" role="img" aria-label="${label}">
    <defs><marker id="continuous-arrow-${kind}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
    <text class="graph-caption" x="24" y="34">old</text><text class="graph-caption" x="353" y="34">new</text>
    ${relations}${nodes}
    <g class="branch-current"><text class="branch-text" x="306" y="${targetY - 19}">main</text><path class="pointer-line" d="M325 ${targetY - 15} V${targetY - 10} H296" marker-end="url(#continuous-arrow-${kind})" /></g>
    <g class="branch-current"><text class="pointer-text" x="306" y="${targetY - 40}">HEAD</text><path class="pointer-line" d="M325 ${targetY - 36} V${targetY - 24}" marker-end="url(#continuous-arrow-${kind})" /></g>
    <g class="branch-preview"><text class="branch-text" x="364" y="83">main</text><path class="pointer-line" d="M380 87 V96 H385" marker-end="url(#continuous-arrow-${kind})" /></g>
    <g class="branch-preview"><text class="pointer-text" x="364" y="60">HEAD</text><path class="pointer-line" d="M380 64 V75" marker-end="url(#continuous-arrow-${kind})" /></g>
    <g class="preview-flow"><path class="graph-line" d="M25 6 V50 C25 65 55 68 80 68 H374" marker-end="url(#continuous-arrow-${kind})" /><text class="graph-caption" x="28" y="18">from Staging</text></g>
    <g class="new-commit"><circle cx="386" cy="106" r="12" /><text class="commit-text" x="333" y="135">◌ NEW COMMIT</text></g>
    <path class="graph-line-muted" d="M294 ${targetY + 13} C306 ${targetY + 42} 330 166 366 166" />
    <text class="graph-caption" x="370" y="170">origin/main</text>
  </svg>`;
}

function createCompactGraphSvg(
  kind: "linear" | "branch" | "diverged",
  label: string,
): string {
  const relations = {
    linear: `<path class="graph-line" d="M46 94 H136 M154 94 H244" />`,
    branch: `<path class="graph-line" d="M46 104 H130 C152 104 164 64 202 64 H244" /><path class="graph-line" d="M46 104 H130 C152 104 164 138 202 138 H244" />`,
    diverged: `<path class="graph-line" d="M46 94 H130 C152 94 164 58 202 58 H244" /><path class="graph-line" d="M46 94 H130 C152 94 164 130 202 130 H244" />`,
  }[kind];
  const nodes = {
    linear: `<circle class="commit" cx="36" cy="94" r="8" /><circle class="commit" cx="145" cy="94" r="8" /><circle class="commit" cx="253" cy="94" r="8" />`,
    branch: `<circle class="commit" cx="36" cy="104" r="8" /><circle class="commit" cx="139" cy="104" r="8" /><circle class="commit" cx="211" cy="64" r="8" /><circle class="commit" cx="253" cy="64" r="8" /><circle class="commit" cx="211" cy="138" r="8" /><circle class="commit" cx="253" cy="138" r="8" />`,
    diverged: `<circle class="commit" cx="36" cy="94" r="8" /><circle class="commit" cx="139" cy="94" r="8" /><circle class="commit" cx="211" cy="58" r="8" /><circle class="commit" cx="253" cy="58" r="8" /><circle class="commit" cx="211" cy="130" r="8" /><circle class="commit" cx="253" cy="130" r="8" />`,
  }[kind];
  const targetY = kind === "linear" ? 94 : kind === "branch" ? 64 : 58;

  return /* html */ `<svg viewBox="0 0 390 176" role="img" aria-label="${label}">
    <defs><marker id="compact-arrow-${kind}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
    <text class="graph-caption" x="18" y="20">old</text><text class="graph-caption" x="332" y="20">new</text>
    ${relations}${nodes}
    <g class="branch-current"><text class="branch-text" x="266" y="${targetY - 18}">main</text><path class="pointer-line" d="M284 ${targetY - 14} V${targetY - 9}" marker-end="url(#compact-arrow-${kind})" /></g>
    <g class="branch-preview"><text class="branch-text" x="334" y="76">main</text><path class="pointer-line" d="M348 80 V88 H354" marker-end="url(#compact-arrow-${kind})" /></g>
    <g class="branch-current"><text class="pointer-text" x="266" y="${targetY - 38}">HEAD</text><path class="pointer-line" d="M284 ${targetY - 34} V${targetY - 22}" marker-end="url(#compact-arrow-${kind})" /></g>
    <g class="branch-preview"><text class="pointer-text" x="334" y="53">HEAD</text><path class="pointer-line" d="M348 57 V68" marker-end="url(#compact-arrow-${kind})" /></g>
    <g class="preview-flow"><path class="graph-line" d="M354 154 V108" marker-end="url(#compact-arrow-${kind})" /></g>
    <g class="new-commit"><circle cx="354" cy="94" r="11" /><text class="commit-text" x="302" y="122">◌ NEW COMMIT</text></g>
  </svg>`;
}

function createGraphSvg(kind: "linear" | "branch" | "diverged", label: string): string {
  const relations = {
    linear: `<path class="graph-line" d="M85 145 H190 M210 145 H315 M335 145 H440" />`,
    branch: `<path class="graph-line" d="M85 160 H190 C230 160 236 95 295 95 H420" /><path class="graph-line" d="M85 160 H190 C230 160 236 205 295 205 H420" />`,
    diverged: `<path class="graph-line" d="M85 145 H190 C225 145 245 95 295 95 H420" /><path class="graph-line" d="M85 145 H190 C225 145 245 195 295 195 H420" />`,
  }[kind];
  const nodes = {
    linear: `<g><circle class="commit" cx="75" cy="145" r="10" /><text class="commit-text" x="58" y="174">a1b2</text><circle class="commit" cx="200" cy="145" r="10" /><text class="commit-text" x="183" y="174">c3d4</text><circle class="commit" cx="325" cy="145" r="10" /><text class="commit-text" x="308" y="174">e5f6</text><circle class="commit" cx="450" cy="145" r="10" /><text class="commit-text" x="433" y="174">g7h8</text></g>`,
    branch: `<g><circle class="commit" cx="75" cy="160" r="10" /><text class="commit-text" x="58" y="188">a1b2</text><circle class="commit" cx="200" cy="160" r="10" /><text class="commit-text" x="183" y="188">c3d4</text><circle class="commit" cx="305" cy="95" r="10" /><text class="commit-text" x="288" y="77">e5f6</text><circle class="commit" cx="430" cy="95" r="10" /><text class="commit-text" x="413" y="77">g7h8</text><circle class="commit" cx="305" cy="205" r="10" /><text class="commit-text" x="288" y="233">i9j0</text><circle class="commit" cx="430" cy="205" r="10" /><text class="commit-text" x="413" y="233">k1l2</text></g>`,
    diverged: `<g><circle class="commit" cx="75" cy="145" r="10" /><text class="commit-text" x="58" y="174">a1b2</text><circle class="commit" cx="200" cy="145" r="10" /><text class="commit-text" x="183" y="174">c3d4</text><circle class="commit" cx="305" cy="95" r="10" /><text class="commit-text" x="288" y="77">e5f6</text><circle class="commit" cx="430" cy="95" r="10" /><text class="commit-text" x="413" y="77">g7h8</text><circle class="commit" cx="305" cy="195" r="10" /><text class="commit-text" x="288" y="223">m3n4</text><circle class="commit" cx="430" cy="195" r="10" /><text class="commit-text" x="413" y="223">o5p6</text></g>`,
  }[kind];
  const currentPointer = kind === "linear"
    ? `<path class="pointer-line" d="M424 62 V125 H448" marker-end="url(#arrow-${kind})" />`
    : `<path class="pointer-line" d="M424 62 V84 H428" marker-end="url(#arrow-${kind})" />`;

  return /* html */ `<svg viewBox="0 0 570 255" role="img" aria-label="${label}">
    <defs><marker id="arrow-${kind}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
    <text class="graph-caption" x="18" y="24">old</text><text class="graph-caption" x="516" y="24">new</text>
    <path class="graph-line-muted" d="M45 45 H520" marker-end="url(#arrow-${kind})" />
    ${relations}${nodes}
    <g class="branch-current"><rect class="branch-label" x="388" y="38" width="72" height="24" rx="4" /><text class="branch-text" x="401" y="54">main</text>${currentPointer}</g>
    <g class="branch-preview"><rect class="branch-label" x="470" y="38" width="72" height="24" rx="4" /><text class="branch-text" x="483" y="54">main</text><path class="pointer-line" d="M506 62 V134 H508" marker-end="url(#arrow-${kind})" /></g>
    <g class="branch-current"><rect class="head-label" x="388" y="4" width="72" height="24" rx="4" /><text class="pointer-text" x="401" y="20">HEAD</text><path class="pointer-line" d="M424 28 V38" marker-end="url(#arrow-${kind})" /></g>
    <g class="branch-preview"><rect class="head-label" x="470" y="4" width="72" height="24" rx="4" /><text class="pointer-text" x="483" y="20">HEAD</text><path class="pointer-line" d="M506 28 V38" marker-end="url(#arrow-${kind})" /></g>
    <g class="preview-flow"><path class="graph-line" d="M510 228 V166" marker-end="url(#arrow-${kind})" /><text class="graph-caption" x="475" y="246">from Staging</text></g>
    <g class="new-commit"><circle cx="510" cy="145" r="13" /><text class="commit-text" x="476" y="118">◌ NEW COMMIT</text></g>
  </svg>`;
}

function createNonce(): string {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}
