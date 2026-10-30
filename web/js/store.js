// Scene state: actuators ("parts") and the connecting structures between them.
// No three.js and no DOM, so it can be unit-tested with `node --test`.
//
// part      = { id, name, entry, pose: { position:[x,y,z] mm, quaternion:[x,y,z,w] } }
// structure = { id, a:{part,face}, b:{part,face}, pad, material, snapshot, domain }
//             face is "housing" or "output"; domain comes from domain.js

import { QUAT_IDENTITY } from "./vec.js";
import { encode, decode } from "./domain.js";

export const FORMAT_VERSION = 1;

export function createStore() {
  const parts = new Map();
  const structures = new Map();
  const listeners = new Set();
  let nextId = 1;

  const emit = (kind, id) => listeners.forEach((fn) => fn(kind, id));
  const newId = (prefix) => `${prefix}${nextId++}`;
  const copyPose = (pose) => ({
    position: [...pose.position],
    quaternion: [...pose.quaternion],
  });

  const store = {
    parts,
    structures,

    /** Subscribe to changes: fn(kind, id). Returns an unsubscribe function. */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    addPart(entry, position = [0, 0, 0], quaternion = QUAT_IDENTITY) {
      const part = {
        id: newId("p"),
        name: entry.name,
        entry,
        pose: copyPose({ position, quaternion }),
      };
      parts.set(part.id, part);
      emit("part-added", part.id);
      return part;
    },

    /** Remove a part and every structure attached to it. Returns removed structure ids. */
    removePart(id) {
      const gone = [];
      for (const s of [...structures.values()]) {
        if (s.a.part === id || s.b.part === id) {
          structures.delete(s.id);
          gone.push(s.id);
          emit("structure-removed", s.id);
        }
      }
      parts.delete(id);
      emit("part-removed", id);
      return gone;
    },

    setPose(id, pose) {
      const part = parts.get(id);
      if (!part) return;
      part.pose = copyPose(pose);
      emit("part-moved", id);
    },

    duplicatePart(id, offset = [0, 0, 0]) {
      const src = parts.get(id);
      if (!src) return null;
      const position = src.pose.position.map((v, i) => v + offset[i]);
      return store.addPart(src.entry, position, src.pose.quaternion);
    },

    addStructure({ a, b, pad, material = "PLA", snapshot, domain }) {
      const s = { id: newId("s"), a, b, pad, material, snapshot, domain };
      structures.set(s.id, s);
      emit("structure-added", s.id);
      return s;
    },

    removeStructure(id) {
      if (structures.delete(id)) emit("structure-removed", id);
    },

    /** Tell listeners a structure changed (domain painted, re-fitted, material changed...). */
    touchStructure(id) {
      emit("structure-changed", id);
    },

    clear() {
      parts.clear();
      structures.clear();
      nextId = 1;
      emit("loaded", null);
    },

    toJSON() {
      return {
        version: FORMAT_VERSION,
        parts: [...parts.values()].map((p) => ({
          id: p.id,
          name: p.name,
          position: p.pose.position,
          quaternion: p.pose.quaternion,
        })),
        structures: [...structures.values()].map((s) => ({
          id: s.id,
          a: s.a,
          b: s.b,
          pad: s.pad,
          material: s.material,
          snapshot: s.snapshot,
          domain: encode(s.domain),
        })),
      };
    },

    /**
     * Replace the scene from JSON. `catalogByName` maps actuator name -> catalogue entry.
     * Returns a list of warning strings (unknown actuators, dropped structures).
     */
    load(json, catalogByName) {
      const warnings = [];
      parts.clear();
      structures.clear();
      let maxId = 0;
      const track = (id) => {
        const n = parseInt(String(id).slice(1), 10);
        if (Number.isFinite(n)) maxId = Math.max(maxId, n);
      };
      for (const p of json.parts ?? []) {
        const entry = catalogByName.get(p.name);
        if (!entry) {
          warnings.push(`Actuator "${p.name}" is not in the catalogue; skipped.`);
          continue;
        }
        parts.set(p.id, { id: p.id, name: p.name, entry, pose: copyPose(p) });
        track(p.id);
      }
      for (const s of json.structures ?? []) {
        if (!parts.has(s.a.part) || !parts.has(s.b.part)) {
          warnings.push(`Structure ${s.id} refers to a missing actuator; dropped.`);
          continue;
        }
        structures.set(s.id, { ...s, domain: decode(s.domain) });
        track(s.id);
      }
      nextId = maxId + 1;
      emit("loaded", null);
      return warnings;
    },
  };
  return store;
}
