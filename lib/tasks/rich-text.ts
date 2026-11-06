import { getSchema } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import ListItem from "@tiptap/extension-list-item";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import { canonicalJSON, invalid, object, validUnicode } from "./validation";
export const descriptionExtensionsV1 = [
  Document,
  Paragraph,
  Text,
  BulletList,
  OrderedList,
  ListItem,
  Bold,
  Italic,
  Link.configure({
    openOnClick: false,
    HTMLAttributes: { target: "_blank", rel: "noopener noreferrer nofollow" },
  }),
];
export const descriptionSchemaV1 = getSchema(descriptionExtensionsV1);
export type RichNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: RichNode[];
  content?: RichNode[];
};
export function canonicalizeDescriptionV1(input: unknown): RichNode | null {
  if (input === null) return null;
  let count = 0;
  function node(value: unknown, depth: number, allowed: string[]): RichNode {
    if (++count > 5000 || depth > 20) invalid("description");
    const n = object(value, ["type", "text", "attrs", "marks", "content"]);
    if (typeof n.type !== "string" || !allowed.includes(n.type))
      invalid("description");
    const type = n.type;
    const permitted =
      type === "text"
        ? ["type", "text", "marks"]
        : type === "orderedList"
          ? ["type", "content", "attrs"]
          : ["type", "content"];
    object(n, permitted);
    if (type === "text") {
      if (typeof n.text !== "string" || !n.text || !validUnicode(n.text))
        invalid("description");
      const out: RichNode = { type, text: n.text };
      if (n.marks !== undefined) {
        if (!Array.isArray(n.marks)) invalid("description");
        const seen = new Set<string>();
        const marks = n.marks
          .map((value) => {
            const mark = object(value, ["type", "attrs"]);
            if (
              typeof mark.type !== "string" ||
              !["bold", "italic", "link"].includes(mark.type) ||
              seen.has(mark.type)
            )
              invalid("description");
            seen.add(mark.type);
            if (mark.type !== "link") {
              object(mark, ["type"]);
              return { type: mark.type };
            }
            const attrs = object(mark.attrs, ["href"]);
            if (typeof attrs.href !== "string") invalid("description");
            const href = attrs.href.trim();
            if (
              !validUnicode(href) ||
              /[\u0000-\u001f\u007f-\u009f]/.test(href) ||
              [...href].length > 2048
            )
              invalid("description");
            try {
              if (
                !["https:", "http:", "mailto:"].includes(new URL(href).protocol)
              )
                invalid("description");
            } catch {
              invalid("description");
            }
            return { type: "link", attrs: { href } };
          })
          .sort(
            (a, b) =>
              ["bold", "italic", "link"].indexOf(a.type) -
              ["bold", "italic", "link"].indexOf(b.type),
          );
        if (marks.length) out.marks = marks;
      }
      return out;
    }
    if (n.content !== undefined && !Array.isArray(n.content))
      invalid("description");
    const children =
      type === "paragraph"
        ? ["text"]
        : type === "bulletList" || type === "orderedList"
          ? ["listItem"]
          : ["paragraph", "bulletList", "orderedList"];
    const content = ((n.content ?? []) as unknown[]).map((c) =>
      node(c, depth + 1, children),
    );
    if (
      ["bulletList", "orderedList", "listItem"].includes(type) &&
      !content.length
    )
      invalid("description");
    if (type === "listItem" && content[0].type !== "paragraph")
      invalid("description");
    const out: RichNode = { type };
    if (type === "orderedList") {
      const attrs = n.attrs === undefined ? {} : object(n.attrs, ["start"]);
      const start = attrs.start ?? 1;
      if (
        !Number.isInteger(start) ||
        Number(start) < 1 ||
        Number(start) > 1000000
      )
        invalid("description");
      out.attrs = { start };
    }
    const merged: RichNode[] = [];
    for (const c of content) {
      const prev = merged.at(-1);
      if (
        c.type === "text" &&
        prev?.type === "text" &&
        canonicalJSON(c.marks ?? []) === canonicalJSON(prev.marks ?? [])
      )
        prev.text! += c.text;
      else merged.push(c);
    }
    if (merged.length) out.content = merged;
    return out;
  }
  const result = node(input, 1, ["doc"]);
  if (
    !result.content ||
    result.content.every((c) => c.type === "paragraph" && !c.content)
  )
    return null;
  if (new TextEncoder().encode(JSON.stringify(result)).length > 102400)
    invalid("description");
  try {
    descriptionSchemaV1.nodeFromJSON(result).check();
  } catch {
    invalid("description");
  }
  return result;
}
// Project only editor defaults. Direct API callers always use the strict validator above.
export function serializeEditorDescriptionV1(input: RichNode) {
  const project = (n: RichNode): RichNode => ({
    type: n.type,
    ...(n.text !== undefined ? { text: n.text } : {}),
    ...(n.type === "orderedList"
      ? { attrs: { start: n.attrs?.start ?? 1 } }
      : {}),
    ...(n.content ? { content: n.content.map(project) } : {}),
    ...(n.marks
      ? {
          marks: n.marks.map((m) =>
            m.type === "link"
              ? { type: "link", attrs: { href: m.attrs?.href } }
              : { type: m.type },
          ),
        }
      : {}),
  });
  return canonicalizeDescriptionV1(project(input));
}
