import { isValidElement, type ReactNode } from "react";
import { AppErrorBoundary } from "./AppErrorBoundary";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function childrenOf(node: ReactNode): ReactNode[] {
  if (!isValidElement(node)) return [];
  const children = (node.props as { children?: ReactNode }).children;
  return Array.isArray(children) ? children : children == null ? [] : [children];
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return childrenOf(node).map(textOf).join("");
  return "";
}

const derived = AppErrorBoundary.getDerivedStateFromError(new Error("Planner output was invalid"));
assert(derived.errorMessage === "Planner output was invalid", "error boundary should preserve render error message");

const boundary = new AppErrorBoundary({ children: null });
boundary.state = derived;
const fallbackText = textOf(boundary.render());

assert(fallbackText.includes("NF hit a UI rendering problem"), "error boundary should render a visible fallback");
assert(fallbackText.includes("No project files were created"), "error boundary should make file safety explicit");
assert(fallbackText.includes("Planner output was invalid"), "error boundary should show the render error details");

console.log("app error boundary regression passed");
