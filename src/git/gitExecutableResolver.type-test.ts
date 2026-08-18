import type * as vscode from "vscode";
import type {
  VscodeExtensions,
} from "./gitExecutableResolver";

type Assert<T extends true> = T;

type VscodeExtensionsAreCompatible = Assert<
  typeof vscode.extensions extends VscodeExtensions ? true : false
>;

void (undefined as unknown as VscodeExtensionsAreCompatible);
