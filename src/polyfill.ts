import { DOMParser as XDOMParser } from '@xmldom/xmldom';

// Polyfill DOMParser for AWS SDK EC2 XML deserialization.
// @aws-sdk/xml-builder uses the "browser" conditional export which
// expects globalThis.DOMParser, but Cloudflare Workers doesn't provide it.
globalThis.DOMParser = XDOMParser;

// Polyfill Node for AWS SDK EC2 XML deserialization which references global Node types
if (!(globalThis as any).Node) {
  const FakeNode = class {};
  const constants = {
    ELEMENT_NODE: 1,
    ATTRIBUTE_NODE: 2,
    TEXT_NODE: 3,
    CDATA_SECTION_NODE: 4,
    ENTITY_REFERENCE_NODE: 5,
    ENTITY_NODE: 6,
    PROCESSING_INSTRUCTION_NODE: 7,
    COMMENT_NODE: 8,
    DOCUMENT_NODE: 9,
    DOCUMENT_TYPE_NODE: 10,
    DOCUMENT_FRAGMENT_NODE: 11,
    NOTATION_NODE: 12,
  };
  Object.assign(FakeNode, constants);
  Object.assign(FakeNode.prototype, constants);
  (globalThis as any).Node = FakeNode;
}
