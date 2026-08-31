import * as vscode from "vscode";
import { createSidebarPresentation, type SidebarNode } from "./sidebarPresentation";
import { RepositoryStateSnapshotStore } from "./repositoryStateSnapshot";
import { AppViewStateStore } from "../domain/appViewStateStore";
import type { SelectionState } from "../domain/appViewState";

export const GIT_BEARINGS_SIDEBAR_VIEW_ID = "gitBearings.sidebar";

export function createGitBearingsSidebar(snapshotStore: RepositoryStateSnapshotStore, viewState: AppViewStateStore<unknown>): vscode.Disposable {
  const provider = new GitBearingsSidebarProvider(snapshotStore, viewState);
  const treeView = vscode.window.createTreeView(GIT_BEARINGS_SIDEBAR_VIEW_ID, { treeDataProvider: provider });
  const selectionSubscription = viewState.onDidChange((state) => {
    const item = provider.itemForSelection(state.selection);
    if (item) void treeView.reveal(item, { select: true, focus: false, expand: true });
  });
  return vscode.Disposable.from(treeView, provider, selectionSubscription);
}

class GitBearingsSidebarProvider implements vscode.TreeDataProvider<SidebarItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<SidebarItem | undefined>();
  private readonly snapshotSubscription: { dispose(): void };

  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly snapshotStore: RepositoryStateSnapshotStore, private readonly viewState: AppViewStateStore<unknown>) {
    this.snapshotSubscription = snapshotStore.onDidChange(() => this.changed.fire(undefined));
  }

  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SidebarItem): SidebarItem[] {
    const nodes = element ? element.node.children ?? [] : createSidebarPresentation(this.snapshotStore.current);
    return nodes.map((node) => new SidebarItem(node, element));
  }

  getParent(element: SidebarItem): SidebarItem | undefined { return element.parent; }

  itemForSelection(selection: SelectionState): SidebarItem | undefined {
    const find = (nodes: readonly SidebarNode[], parent?: SidebarItem): SidebarItem | undefined => {
      for (const node of nodes) {
        const item = new SidebarItem(node, parent);
        if (sameSelection(node.selection, selection)) return item;
        const child = find(node.children ?? [], item); if (child) return child;
      }
      return undefined;
    };
    return find(createSidebarPresentation(this.snapshotStore.current));
  }

  dispose(): void { this.snapshotSubscription.dispose(); this.changed.dispose(); }
}

class SidebarItem extends vscode.TreeItem {
  constructor(readonly node: SidebarNode, readonly parent: SidebarItem | undefined) {
    super(node.label, toVscodeCollapsibleState(node.collapsible));
    this.id = node.id;
    this.description = node.description;
    this.tooltip = node.tooltip ?? [node.label, node.description].filter(Boolean).join("\n");
    if (node.selection) this.command = { command: "gitBearings.selectSelection", title: "Git Bearings: 選択", arguments: [node.selection] };
    else if (node.command) this.command = node.command;
  }
}

function sameSelection(left: SelectionState | undefined, right: SelectionState): boolean { return left !== undefined && JSON.stringify(left) === JSON.stringify(right); }

function toVscodeCollapsibleState(value: SidebarNode["collapsible"]): vscode.TreeItemCollapsibleState {
  if (value === "expanded") return vscode.TreeItemCollapsibleState.Expanded;
  if (value === "collapsed") return vscode.TreeItemCollapsibleState.Collapsed;
  return vscode.TreeItemCollapsibleState.None;
}
