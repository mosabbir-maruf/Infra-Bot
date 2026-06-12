import { DOMParser as XDOMParser } from '@xmldom/xmldom';

// Polyfill DOMParser for AWS SDK EC2 XML deserialization.
// @aws-sdk/xml-builder uses the "browser" conditional export which
// expects globalThis.DOMParser, but Cloudflare Workers doesn't provide it.
globalThis.DOMParser = XDOMParser;
