/**
 * Message router: prioritizes file actions over generic chat.
 */

import {
  classifyFileActionIntent,
  type FileActionIntent,
  type FileActionIntentType,
} from "./fileActionIntent";

export type RouteDecision =
  | { action: "file_open"; targetPath: string }
  | { action: "file_edit"; targetPath: string; instructions: string }
  | { action: "chat" };

/**
 * Route user message. Must be called before any chat/patch generation.
 */
export function routeUserMessage(message: string): RouteDecision {
  const intent = classifyFileActionIntent(message);

  if (intent.intentType === "none" || intent.targets.length === 0) {
    console.log("router: no file intent, fallback to chat");
    return { action: "chat" };
  }

  const primary = intent.targets[0];
  console.log("router:", intent.intentType, "target:", primary.path, "instructions:", intent.instructions || "(none)");

  if (intent.intentType === "file_edit") {
    return {
      action: "file_edit",
      targetPath: primary.path,
      instructions: intent.instructions,
    };
  }

  return {
    action: "file_open",
    targetPath: primary.path,
  };
}
