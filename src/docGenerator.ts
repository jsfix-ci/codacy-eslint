import { JSONSchema4 } from "json-schema"
import { flatMap, flatMapDeep, partition, toPairs } from "lodash"
import fetch from "node-fetch"
import { defaultEngine } from "./eslintDefaultOptions"
import { DescriptionEntry } from "./model/Description"
import {
  Category,
  fromEslintCategoryToCategory,
  fromEslintCategoryToLevel,
  Level,
  patternIdToCodacy,
  Patterns,
  PatternsEntry,
  PatternsParameter
} from "./model/Patterns"
import { toolName, toolVersion } from "./toolMetadata"
import { writeFile } from "./fileUtils"

export function generatePatterns(): Patterns {
  const rules = defaultEngine.getRules()
  const patterns = Array.from(rules.entries()).map(
    ([patternId, ruleModule]) => {
      const meta = ruleModule && ruleModule.meta ? ruleModule.meta : undefined
      const eslintCategory = meta && meta.docs ? meta.docs.category : undefined
      const level: Level = fromEslintCategoryToLevel(eslintCategory)
      const category: Category = patternId.includes("security")
        ? "Security"
        : fromEslintCategoryToCategory(eslintCategory)
      const parameters =
        meta && meta.schema
          ? fromEslintSchemaToParameters(meta.schema)
          : undefined
      return new PatternsEntry(
        patternIdToCodacy(patternId),
        level,
        category,
        parameters && parameters.length > 0 ? parameters : undefined
      )
    }
  )
  const entries = patterns.filter(x => x !== null) as PatternsEntry[]
  return new Patterns(toolName, toolVersion, entries)
}

export function generateDescription(): DescriptionEntry[] {
  const rules = defaultEngine.getRules()
  const descriptionEntries = Array.from(rules.entries()).map(
    ([patternId, ruleModule]) => {
      const eslintDescription =
        ruleModule && ruleModule.meta && ruleModule.meta.docs
          ? ruleModule.meta.docs.description
          : undefined
      const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
      const description = eslintDescription ? capitalize(eslintDescription) : ""
      const title = patternId
        .split("/")
        .map(s =>
          capitalize(s)
            .split("-")
            .join(" ")
        )
        .join(": ")
      const timeToFix = 5
      return new DescriptionEntry(
        patternIdToCodacy(patternId),
        title,
        description,
        timeToFix
      )
    }
  )
  return descriptionEntries.filter(x => x !== null) as DescriptionEntry[]
}

type WithDefault = { default: any }

function anyOfToArray(schema: JSONSchema4) {
  return schema.anyOf ? schema.anyOf : [schema]
}

function fromEslintSchemaToParameters(
  schema: JSONSchema4 | JSONSchema4[]
): PatternsParameter[] {
  const flattenSchema = <JSONSchema4[]>(
    (<unknown>flatMapDeep(schema, anyOfToArray))
  )

  if (Array.isArray(flattenSchema)) {
    const objects = flattenSchema.filter(value => value && value.properties)
    const namedParameters = flatMap(objects, o => {
      const pairs = toPairs(o.properties)
      const haveDefault = pairs.filter(
        ([k, v]) => v && (v as WithDefault) && v.default
      ) as [string, WithDefault][]
      return haveDefault.map(([k, v]) => {
        return new PatternsParameter(k, v.default)
      })
    })
    return namedParameters
  }
  return []
}

function patternIdsWithoutPrefix(prefix: string): Array<string> {
  const longPrefix = prefix + "/"
  const rules = defaultEngine.getRules()
  const patternIds = Array.from(rules.entries()).map(e => e[0])
  const filteredPatternIds = patternIds.filter(patternId =>
    patternId.startsWith(longPrefix)
  )
  return filteredPatternIds.map(patternId =>
    patternId.substring(longPrefix.length)
  )
}

function eslintPatternIds(): Array<string> {
  const rules = defaultEngine.getRules()
  return Array.from(rules.keys()).filter(e => !e.includes("/"))
}

export function downloadDocs(
  urlFromPatternId: (patternId: string) => string,
  prefix: string = ""
) {
  const patterns =
    prefix.length > 0 ? patternIdsWithoutPrefix(prefix) : eslintPatternIds()
  const promises: Promise<void>[] = patterns.map(async pattern => {
    const url: string = urlFromPatternId(pattern)
    const result = await fetch(url)
    if (result.ok) {
      const text = await result.text()
      const filename =
        "docs/description/" +
        (prefix.length > 0 ? prefix + "_" : "") +
        patternIdToCodacy(pattern) +
        ".md"
      return writeFile(filename, text)
    } else return Promise.resolve()
  })
  return Promise.all(promises)
}
