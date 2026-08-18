import * as vscode from "vscode";

export const GIT_BEARINGS_SIDEBAR_VIEW_ID = "gitBearings.sidebar";

export function createGitBearingsSidebar(): vscode.TreeView<SidebarItem> {
  return vscode.window.createTreeView(GIT_BEARINGS_SIDEBAR_VIEW_ID, {
    treeDataProvider: new GitBearingsSidebarProvider(),
  });
}

class GitBearingsSidebarProvider
  implements vscode.TreeDataProvider<SidebarItem>
{
  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SidebarItem): SidebarItem[] {
    if (!element) {
      return [
        new SidebarItem(
          "UI試作（実Git状態ではありません）",
          "static fixture",
          vscode.TreeItemCollapsibleState.Expanded,
        ),
      ];
    }

    return [
      new SidebarItem("あなたは今ここ — 自然文の表示領域", "placeholder"),
      new SidebarItem("作業中の変更 — fixture", "placeholder"),
      new SidebarItem("比較・Remote — fixture", "placeholder"),
    ];
  }
}

class SidebarItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    collapsibleState = vscode.TreeItemCollapsibleState.None,
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.tooltip = `${label}\nこれはUI試作の静的fixtureです。`;
  }
}
