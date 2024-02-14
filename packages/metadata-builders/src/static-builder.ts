import { StringRecord, V15 } from "@polkadot-api/substrate-bindings"
import { LookupEntry, getLookupFn } from "./lookups"
import { withCache } from "./with-cache"

type MetadataPrimitives =
  | "bool"
  | "char"
  | "str"
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "u128"
  | "u256"
  | "i8"
  | "i16"
  | "i32"
  | "i64"
  | "i128"
  | "i256"

export const primitiveTypes: Record<
  | MetadataPrimitives
  | "_void"
  | "compactNumber"
  | "compactBn"
  | "bitSequence"
  | "historicMetaCompat",
  string
> = {
  _void: "undefined",
  bool: "boolean",
  char: "string",
  str: "string",
  u8: "number",
  u16: "number",
  u32: "number",
  u64: "bigint",
  u128: "bigint",
  u256: "bigint",
  i8: "number",
  i16: "number",
  i32: "number",
  i64: "bigint",
  i128: "bigint",
  i256: "bigint",
  compactNumber: "number",
  compactBn: "bigint",
  bitSequence: "{bitsLen: number, bytes: Uint8Array}",
  historicMetaCompat: "any",
}

export interface Variable {
  id: string
  types: string
  value: string
  directDependencies: Set<string>
}

export interface CodeDeclarations {
  imports: Set<string>
  typeImports: Set<string>
  enums: Map<string, string>
  variables: Map<string, Variable>
}

const toCamelCase = (...parts: string[]): string =>
  parts[0] +
  parts
    .slice(1)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("")

const getTypes = (varName: string) =>
  primitiveTypes[varName as keyof typeof primitiveTypes] ?? varName

const _buildSyntax = (
  input: LookupEntry,
  cache: Map<number, string>,
  stack: Set<number>,
  declarations: CodeDeclarations,
  getVarName: (id: number, ...post: string[]) => string,
): string => {
  if (input.type === "primitive") {
    declarations.imports.add(input.value)
    return input.value
  }

  if (input.type === "AccountId32") {
    declarations.imports.add("AccountId")
    const id = "_accountId"
    declarations.variables.set(id, {
      id,
      value: `AccountId()`,
      types: "SS58String",
      directDependencies: new Set<string>(),
    })
    declarations.typeImports.add("SS58String")
    return id
  }

  if (input.type === "compact") {
    const importVal = input.isBig ? "compactBn" : "compactNumber"
    declarations.imports.add(importVal)
    return importVal
  }

  if (input.type === "bitSequence") {
    declarations.imports.add(input.type)
    return input.type
  }

  if (
    input.type === "sequence" &&
    input.value.type === "primitive" &&
    input.value.value === "u8"
  ) {
    declarations.imports.add("Bin")
    declarations.typeImports.add("HexString")
    declarations.typeImports.add("Binary")
    const variable = {
      id: "_bytesSeq",
      value: "Bin()",
      types: "Binary",
      directDependencies: new Set<string>(),
    }

    if (!declarations.variables.has(variable.id)) {
      declarations.variables.set(variable.id, variable)
    }

    return variable.id
  }

  if (declarations.variables.has(getVarName(input.id, "circular")))
    return getVarName(input.id, "circular")

  if (declarations.variables.has(getVarName(input.id)))
    return getVarName(input.id)

  const buildNextSyntax = (nextInput: LookupEntry): string =>
    buildSyntax(nextInput, cache, stack, declarations, getVarName)

  const buildVector = (id: string, inner: LookupEntry, len?: number) => {
    declarations.imports.add("Vector")
    const dependsVar = buildNextSyntax(inner)
    const args = len ? [dependsVar, len] : [dependsVar]
    const variable = {
      id,
      value: `Vector(${args.join(", ")})`,
      types: `Array<${getTypes(dependsVar)}>`,
      directDependencies: new Set<string>([dependsVar]),
    }
    declarations.variables.set(id, variable)
    return id
  }

  const buildTuple = (id: string, value: LookupEntry[]) => {
    declarations.imports.add("Tuple")
    const deps = value.map(buildNextSyntax)
    const variable = {
      id,
      value: `Tuple(${deps.join(", ")})`,
      types: `[${deps.map(getTypes).join(", ")}]`,
      directDependencies: new Set(deps),
    }
    declarations.variables.set(id, variable)
    return id
  }

  const buildStruct = (id: string, value: StringRecord<LookupEntry>) => {
    declarations.imports.add("Struct")
    const deps = Object.values(value).map(buildNextSyntax)
    const variable = {
      id,
      value: `Struct({${Object.keys(value)
        .map((key, idx) => `${key}: ${deps[idx]}`)
        .join(", ")}})`,
      types: `{${Object.keys(value)
        .map((key, idx) => `${key}: ${getTypes(deps[idx])}`)
        .join(", ")}}`,
      directDependencies: new Set(deps),
    }
    declarations.variables.set(id, variable)
    return id
  }

  const varId = getVarName(input.id)
  if (input.type === "array") {
    // Bytes case
    if (input.value.type === "primitive" && input.value.value === "u8") {
      declarations.imports.add("Bin")
      declarations.variables.set(varId, {
        id: varId,
        value: `Bin(${input.len})`,
        types: "Binary",
        directDependencies: new Set<string>(),
      })
      declarations.typeImports.add("HexString")
      declarations.typeImports.add("Binary")
      return varId
    }

    // non-fixed size Vector case
    return buildVector(varId, input.value, input.len)
  }

  if (input.type === "sequence") return buildVector(varId, input.value)
  if (input.type === "tuple") return buildTuple(varId, input.value)
  if (input.type === "struct") return buildStruct(varId, input.value)

  if (input.type === "option") {
    declarations.imports.add("Option")
    const inner = buildNextSyntax(input.value)
    const id = `_Option_${inner}`
    const variable = {
      id,
      value: `Option(${inner})`,
      types: `${getTypes(inner)} | undefined`,
      directDependencies: new Set<string>([inner]),
    }
    declarations.variables.set(id, variable)
    return id
  }

  if (input.type === "result") {
    declarations.imports.add("Result")
    declarations.typeImports.add("ResultPayload")
    const ok = buildNextSyntax(input.value.ok)
    const ko = buildNextSyntax(input.value.ko)
    const id = `_Result_${ok}_${ko}`
    const variable = {
      id,
      value: `Result(${ok}, ${ko})`,
      types: `ResultPayload<${getTypes(ok)}, ${getTypes(ko)}>`,
      directDependencies: new Set<string>([ok, ko]),
    }
    declarations.variables.set(id, variable)
    return id
  }

  // it has to be an enum by now
  declarations.imports.add("Variant")
  declarations.typeImports.add("Enum")
  const dependencies = Object.entries(input.value).map(([key, value]) => {
    if (value.type === "primitive") {
      declarations.imports.add(value.value)
      return value.value
    }

    const varName = toCamelCase(varId, key)
    if (value.type === "tuple") {
      if (value.value.length === 1) {
        let result: string = buildNextSyntax(value.value[0])

        if (!declarations.variables.has(varName)) {
          declarations.variables.set(varName, {
            id: varName,
            value: result,
            types: getTypes(result),
            directDependencies: new Set([result]),
          })
        }

        return varName
      }
      return buildTuple(varName, value.value)
    } else {
      buildStruct(varName, value.value)
    }
    return varName
  })

  const indexes = Object.values(input.value).map((x) => x.idx)
  const areIndexesSorted = indexes.every((idx, i) => idx === i)

  const innerEnum = `{${Object.keys(input.value).map(
    (key, idx) => `${key}: ${dependencies[idx]}`,
  )}}${areIndexesSorted ? "" : `, [${indexes.join(", ")}]`}`

  declarations.enums.set(
    varId,
    Object.keys(input.value)
      .map(
        (key, idx) => `{type: '${key}', value: ${getTypes(dependencies[idx])}}`,
      )
      .join(" | "),
  )

  declarations.variables.set(varId, {
    id: varId,
    value: `Variant(${innerEnum})`,
    types: `Enum<E${varId}>`,
    directDependencies: new Set<string>(dependencies),
  })
  return varId
}

const buildSyntax = withCache(
  _buildSyntax,
  (_getter, entry, declarations, getVarName) => {
    declarations.imports.add("Self")

    const nonCircular = getVarName(entry.id)
    const variable: Variable = {
      id: getVarName(entry.id, "circular"),
      types: nonCircular,
      value: `Self(() => ${nonCircular})`,
      directDependencies: new Set([nonCircular]),
    }
    declarations.variables.set(variable.id, variable)
    return variable.id
  },
  (x) => x,
)

export const getStaticBuilder = (metadata: V15, namespace: string) => {
  const declarations: CodeDeclarations = {
    imports: new Set<string>(),
    typeImports: new Set<string>(["Codec"]),
    variables: new Map(),
    enums: new Map(),
  }

  const lookupData = metadata.lookup
  const getLookupEntryDef = getLookupFn(lookupData)

  const getVarName = (idx: number, ...post: string[]): string => {
    const { path } = lookupData[idx]
    const parts: string[] =
      path.length === 0
        ? ["cdc" + idx]
        : path[0] === "sp_runtime"
          ? [namespace, path.slice(-1)[0]]
          : [namespace, ...path]

    parts.push(...post)

    return toCamelCase(...parts)
  }

  const cache = new Map()
  const buildDefinition = (id: number) =>
    buildSyntax(
      getLookupEntryDef(id),
      cache,
      new Set(),
      declarations,
      getVarName,
    )

  const buildNamedTuple = (
    params: Array<{ name: string; type: number }>,
    varName: string,
  ) => {
    if (declarations.variables.has(varName)) return varName

    const args = params.map((p) => p.type).map(buildDefinition)
    const names = params.map((p) => p.name)
    declarations.imports.add("Tuple")

    const variable: Variable = {
      id: varName,
      types: `[${names
        .map(
          (name, pIdx) =>
            `${name[0].toUpperCase() + name.slice(1)}: ${getTypes(args[pIdx])}`,
        )
        .join(", ")}]`,
      value: `Tuple(${args.join(", ")})`,
      directDependencies: new Set(args),
    }
    declarations.variables.set(varName, variable)

    return varName
  }

  const EMPTY_TUPLE_VAR_NAME = "_emptyTuple"
  const getEmptyTuple = () => {
    if (!declarations.variables.has(EMPTY_TUPLE_VAR_NAME)) {
      declarations.imports.add("Tuple")

      declarations.variables.set(EMPTY_TUPLE_VAR_NAME, {
        id: EMPTY_TUPLE_VAR_NAME,
        types: `[]`,
        value: `Tuple()`,
        directDependencies: new Set(),
      })
    }
    return EMPTY_TUPLE_VAR_NAME
  }

  const buildStorage = (pallet: string, entry: string) => {
    const storageEntry = metadata.pallets
      .find((x) => x.name === pallet)!
      .storage!.items.find((s) => s.name === entry)!

    if (storageEntry.type.tag === "plain")
      return {
        key: getEmptyTuple(),
        val: buildDefinition(storageEntry.type.value),
      }

    const { key, value } = storageEntry.type.value
    const val = buildDefinition(value)

    const returnKey =
      storageEntry.type.value.hashers.length === 1
        ? buildNamedTuple(
            [{ name: "key", type: key }],
            getVarName(key, "Tupled"),
          )
        : buildDefinition(key)

    return { key: returnKey, val }
  }

  const buildRuntimeCall = (api: string, method: string) => {
    const entry = metadata.apis
      .find((x) => x.name === api)
      ?.methods.find((x) => x.name === method)
    if (!entry) throw null
    return {
      args: buildNamedTuple(entry.inputs, `${api}${method}Args`),
      value: buildDefinition(entry.output),
    }
  }

  const buildVariant =
    (type: "errors" | "events" | "calls") => (pallet: string, name: string) => {
      const lookupEntry = getLookupEntryDef(
        metadata.pallets.find((x) => x.name === pallet)![type]! as number,
      )
      if (lookupEntry.type !== "enum") throw null

      const returnVar = toCamelCase(buildDefinition(lookupEntry.id), name)

      if (
        !declarations.variables.has(returnVar) &&
        lookupEntry.value[name].type === "primitive"
      ) {
        declarations.variables.set(returnVar, {
          id: returnVar,
          value: "_void",
          types: "undefined",
          directDependencies: new Set(),
        })
      }

      return returnVar
    }

  const buildConstant = (pallet: string, constantName: string) => {
    const storageEntry = metadata.pallets
      .find((x) => x.name === pallet)!
      .constants!.find((s) => s.name === constantName)!

    return buildDefinition(storageEntry.type as number)
  }

  const getCode = (): string => {
    const typeImports = `import type {${[...declarations.typeImports].join(
      ", ",
    )}} from "@polkadot-api/client";\n`

    const varImports = `import {${[...declarations.imports].join(
      ", ",
    )}} from "@polkadot-api/substrate-bindings";\n\n`

    const code = [...declarations.variables.values()]
      .map((variable) => {
        const ePrefix = declarations.enums.has(variable.id)
          ? `type E${variable.id} = ${declarations.enums.get(
              variable.id,
            )!};\nexport `
          : ""
        return `${ePrefix}type ${variable.id} = ${variable.types};
const ${variable.id}: Codec<${variable.id}> = ${variable.value};`
      })
      .join("\n\n")

    return `${typeImports}${varImports}${code}`
  }

  const getEnums = () => [...declarations.enums.keys()]

  const getTypeFromVarName = (varName: string) =>
    primitiveTypes[varName as keyof typeof primitiveTypes] ??
    declarations.variables.get(varName)?.types ??
    varName

  return {
    buildDefinition,
    buildStorage,
    buildEvent: buildVariant("events"),
    buildError: buildVariant("errors"),
    buildCall: buildVariant("calls"),
    buildRuntimeCall,
    buildConstant,
    getTypeFromVarName,
    getCode,
    getEnums,
  }
}