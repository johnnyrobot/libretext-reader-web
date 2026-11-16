#!/usr/bin/env node
// Compatibility entry for the existing mirror pipeline. Canonical code is in the annotation repo.
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.LIBRETEXTS_SOCIAL_ANNOTATION_ROOT;
if(!root)throw Error('Set LIBRETEXTS_SOCIAL_ANNOTATION_ROOT to the reviewed libretexts-social-annotation checkout, or run its scripts/stage-annotations.mjs directly.');
await import(pathToFileURL(join(resolve(root),'scripts/stage-annotations.mjs')).href);
