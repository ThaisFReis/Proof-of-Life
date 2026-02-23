import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type PublicLayout = {
  publicInputs: string[];
  // We model Noir public returns as one or more fields. (v3 uses `pub [Field; 2]`.)
  publicOutputs: string[];
};

export type CircuitArtifactEntry = {
  name: string;
  layoutExpected: PublicLayout;
  layoutActual: PublicLayout | null;
  layoutOk: boolean;
  problems: string[];
  expectedPublicFieldCount: number; // inputs + outputs
  actualPublicFieldCount: number | null; // from `target/public_inputs` bytes, if present
  paths: {
    sourceMain: string;
    compiledJson: string | null;
    publicInputsBin: string | null;
    vk: string | null;
    proof: string | null;
  };
};

function normalizeRel(p: string): string {
  return p.split(path.sep).join('/');
}

function fileSizeBytes(p: string): number | null {
  try {
    return fs.statSync(p).size;
  } catch {
    return null;
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  const h = crypto.createHash('sha256');
  h.update(data);
  return h.digest('hex');
}

export function parseNoirSourcePublicLayout(noirSource: string): PublicLayout {
  // Extract `name: pub Field` parameters, in order.
  const publicInputs: string[] = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*pub\s+Field/g;
  for (;;) {
    const m = re.exec(noirSource);
    if (!m) break;
    publicInputs.push(m[1] ?? '');
  }

  let outCount = 0;
  if (/fn\s+main[\s\S]*?\)\s*->\s*pub\s+Field\b/m.test(noirSource)) {
    outCount = 1;
  } else {
    const m = /fn\s+main[\s\S]*?\)\s*->\s*pub\s*\[\s*Field\s*;\s*(\d+)\s*\]/m.exec(noirSource);
    if (m?.[1]) outCount = Number(m[1]);
  }

  const publicOutputs = outCount <= 0
    ? []
    : outCount === 1
      ? ['return_value']
      : Array.from({ length: outCount }, (_, i) => `return_value[${i}]`);
  return { publicInputs, publicOutputs: [...publicOutputs] };
}

function abiTypeFieldCount(abiType: any): number {
  if (!abiType || typeof abiType !== 'object') return 0;
  const kind = String(abiType.kind ?? '');
  if (kind === 'field') return 1;
  if (kind === 'array') {
    const len = Number(abiType.length ?? 0);
    // Noir uses `type` for element type (observed), but be defensive.
    const elem = abiType.type ?? abiType.element_type ?? abiType.typ;
    return Math.max(0, len) * abiTypeFieldCount(elem);
  }
  if (kind === 'tuple') {
    const fields = Array.isArray(abiType.fields) ? abiType.fields : [];
    return fields.reduce((acc, t) => acc + abiTypeFieldCount(t), 0);
  }
  if (kind === 'struct') {
    const fields = Array.isArray(abiType.fields) ? abiType.fields : [];
    // Some Noir versions represent struct fields as { name, type }.
    return fields.reduce((acc, f) => acc + abiTypeFieldCount(f?.type ?? f), 0);
  }
  return 0;
}

export function extractNoirAbiPublicLayout(compiledJson: any): PublicLayout {
  // Noir compiled JSON has the ABI under `abi`.
  const abi = compiledJson?.abi;
  const params = Array.isArray(abi?.parameters) ? abi.parameters : [];

  const publicInputs: string[] = [];
  for (const p of params) {
    if (p?.visibility === 'public') publicInputs.push(String(p?.name ?? ''));
  }

  const rt = abi?.return_type;
  const hasPubOutput = rt?.visibility === 'public';
  const outCount = hasPubOutput ? abiTypeFieldCount(rt?.abi_type) : 0;
  const publicOutputs = outCount <= 0
    ? []
    : outCount === 1
      ? ['return_value']
      : Array.from({ length: outCount }, (_, i) => `return_value[${i}]`);

  return { publicInputs, publicOutputs };
}

export function buildCircuitArtifactEntry(opts: {
  repoRoot: string;
  circuitsDir: string;
  name: string;
}): CircuitArtifactEntry {
  const { repoRoot, circuitsDir, name } = opts;
  const circuitDir = path.join(circuitsDir, name);

  const absSourceMain = path.join(circuitDir, 'src', 'main.nr');
  const absCompiledJson = path.join(circuitDir, 'target', `${name}.json`);
  const absPublicInputsBin = path.join(circuitDir, 'target', 'public_inputs');
  const absVk = path.join(circuitDir, 'target', 'vk');
  const absProof = path.join(circuitDir, 'target', 'proof');

  const noirSource = fs.readFileSync(absSourceMain, 'utf8');
  const layoutExpected = parseNoirSourcePublicLayout(noirSource);
  const expectedPublicFieldCount = layoutExpected.publicInputs.length + layoutExpected.publicOutputs.length;

  let layoutActual: PublicLayout | null = null;
  if (fs.existsSync(absCompiledJson)) {
    const compiled = JSON.parse(fs.readFileSync(absCompiledJson, 'utf8'));
    layoutActual = extractNoirAbiPublicLayout(compiled);
  }

  const problems: string[] = [];
  let layoutOk = true;

  if (!layoutActual) {
    layoutOk = false;
    problems.push(`missing compiled circuit JSON: ${normalizeRel(path.relative(repoRoot, absCompiledJson))}`);
  } else {
    if (layoutActual.publicInputs.join(',') !== layoutExpected.publicInputs.join(',')) {
      layoutOk = false;
      problems.push(
        `public input ordering mismatch: expected (${layoutExpected.publicInputs.join(
          ', ',
        )}) got (${layoutActual.publicInputs.join(', ')})`,
      );
    }
    if (layoutActual.publicOutputs.join(',') !== layoutExpected.publicOutputs.join(',')) {
      layoutOk = false;
      problems.push(
        `public output mismatch: expected (${layoutExpected.publicOutputs.join(
          ', ',
        )}) got (${layoutActual.publicOutputs.join(', ')})`,
      );
    }
  }

  const sz = fileSizeBytes(absPublicInputsBin);
  const actualPublicFieldCount = sz === null ? null : sz % 32 === 0 ? sz / 32 : null;
  if (actualPublicFieldCount !== null && actualPublicFieldCount !== expectedPublicFieldCount) {
    layoutOk = false;
    problems.push(
      `public_inputs field count mismatch: expected ${expectedPublicFieldCount} got ${actualPublicFieldCount}`,
    );
  }

  return {
    name,
    layoutExpected,
    layoutActual,
    layoutOk,
    problems,
    expectedPublicFieldCount,
    actualPublicFieldCount,
    paths: {
      sourceMain: normalizeRel(path.relative(repoRoot, absSourceMain)),
      compiledJson: fs.existsSync(absCompiledJson) ? normalizeRel(path.relative(repoRoot, absCompiledJson)) : null,
      publicInputsBin: fs.existsSync(absPublicInputsBin)
        ? normalizeRel(path.relative(repoRoot, absPublicInputsBin))
        : null,
      vk: fs.existsSync(absVk) ? normalizeRel(path.relative(repoRoot, absVk)) : null,
      proof: fs.existsSync(absProof) ? normalizeRel(path.relative(repoRoot, absProof)) : null,
    },
  };
}
