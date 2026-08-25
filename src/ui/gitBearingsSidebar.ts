import * as vscode from "vscode";
import { createSidebarPresentation, type SidebarNode } from "./sidebarPresentation";
import { RepositoryStateSnapshotStore } from "./repositoryStateSnapshot";

export const GIT_BEARINGS_SIDEBAR_VIEW_ID = "gitBearings.sidebar";

export function createGitBearingsSidebar(snapshotStore: RepositoryStateSnapshotStore): vscode.Disposable {
  const provider = new GitBearingsSidebarProvider(snapshotStore);
  const treeView = vscode.window.createTreeView(GIT_BEARINGS_SIDEBAR_VIEW_ID, { treeDataProvider: provider });
  return vscode.Disposable.from(treeView, provider);
}

class GitBearingsSidebarProvider implements vscode.TreeDataProvider<SidebarItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<SidebarItem | undefined>();
  private readonly snapshotSubscription: { dispose(): void };

  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly snapshotStore: RepositoryStateSnapshotStore) {
    this.snapshotSubscription = snapshotStore.onDidChange(() => this.changed.fire(undefined));
  }

  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SidebarItem): SidebarItem[] {
    const nodes = element ? element.node.children ?? [] : createSidebarPresentation(this.snapshotStore.current);
    return nodes.map((node) => new SidebarItem(node));
  }

  dispose(): void { this.snapshotSubscription.dispose(); this.changed.dispose(); }
}

class SidebarItem extends vscode.TreeItem {
  constructor(readonly node: SidebarNode) {
    super(node.label, toVscodeCollapsibleState(node.collapsible));
    this.id = node.id;
    this.description = node.description;
    this.tooltip = node.tooltip ?? [node.label, node.description].filter(Boolean).join("\n");
    if (node.command) this.command = node.command;
  }
}

function toVscodeCollapsibleState(value: SidebarNode["collapsible"]): vscode.TreeItemCollapsibleState {
  if (value === "expanded") return vscode.TreeItemCollapsibleState.Expanded;
  if (value === "collapsed") return vscode.TreeItemCollapsibleState.Collapsed;
  return vscode.TreeItemCollapsibleState.None;
}
