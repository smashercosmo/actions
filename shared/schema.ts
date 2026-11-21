/** Type-only key that records what input a schema accepts. */
declare const accepts: unique symbol;

/**
 * Validates untrusted values, such as API responses or command JSON, and
 * returns them typed.
 *
 * `path` points to the value inside the whole response for error messages. It
 * is empty when validating the root value.
 *
 * `TOutput` and `TInput` differ for helpers such as `optional`: a property may
 * be absent in the input but present as `undefined` in the output.
 */
type Schema<TOutput, TInput = TOutput> = ((
  value: unknown,
  path: string,
) => TOutput) & {
  readonly [accepts]?: { readonly input: TInput };
};

/** Output type of a schema. */
type Infer<TSchema> =
  TSchema extends Schema<infer TOutput, unknown> ? TOutput : never;

/**
 * Input type accepted by a schema. Type tests use it to compare schemas against
 * external types, such as GitHub endpoint responses:
 *
 * ```ts
 * expectTypeOf<GitHubResponse>().toExtend<Input<typeof ResponseSchema>>();
 * ```
 */
type Input<TSchema> = TSchema extends {
  readonly [accepts]?: { readonly input: infer TInput };
}
  ? TInput
  : never;

/**
 * Input accepted by `object(shape)`: optional schema fields may be missing, and
 * readonly inputs are accepted so mutable and readonly external types both
 * fit.
 */
type ObjectInput<TShape> = {
  readonly [
    TKey in keyof TShape as undefined extends Input<TShape[TKey]> ? TKey : never
  ]?: Input<TShape[TKey]>;
} & {
  readonly [
    TKey in keyof TShape as undefined extends Input<TShape[TKey]> ? never : TKey
  ]: Input<TShape[TKey]>;
};

type ObjectOutput<TShape> = {
  -readonly [TKey in keyof TShape]: Infer<TShape[TKey]>;
};

/**
 * Describes only the value type for errors, never the value itself, because API
 * responses can contain secrets.
 *
 * @param value Value that failed validation.
 * @returns The type of the value, e.g. `an array`.
 */
function describe(value: unknown) {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "an array";
  }

  if (value === undefined) {
    return "nothing";
  }

  const type = typeof value;

  return type === "object" ? "an object" : `a ${type}`;
}

function fail(path: string, expected: string, value: unknown): never {
  const where = path === "" ? "" : ` at ${path}`;

  throw new Error(`expected ${expected}${where}, got ${describe(value)}`);
}

function string(): Schema<string> {
  return (value, path) =>
    typeof value === "string" ? value : fail(path, "a string", value);
}

function number(): Schema<number> {
  return (value, path) =>
    typeof value === "number" ? value : fail(path, "a number", value);
}

function boolean(): Schema<boolean> {
  return (value, path) =>
    typeof value === "boolean" ? value : fail(path, "a boolean", value);
}

/**
 * Absolute URL string, for example `https://github.com/octocat`.
 *
 * @returns The schema.
 */
function url(): Schema<string> {
  return (value, path) =>
    typeof value === "string" && URL.canParse(value)
      ? value
      : fail(path, "a URL", value);
}

/**
 * Array whose every item matches `item`.
 *
 * @param item Schema of the items.
 * @returns The schema.
 */
function array<TOutput, TInput>(
  item: Schema<TOutput, TInput>,
): Schema<TOutput[], readonly TInput[]> {
  return (value, path) =>
    Array.isArray(value)
      ? value.map((element, index) => item(element, `${path}[${index}]`))
      : fail(path, "an array", value);
}

/**
 * Object with the checked properties from `shape`. Extra input properties are
 * deliberately dropped so callers only receive validated data.
 *
 * @param shape Schema of each property.
 * @returns The schema.
 */
function object<
  TShape extends Readonly<Record<string, Schema<unknown, unknown>>>,
>(shape: TShape): Schema<ObjectOutput<TShape>, ObjectInput<TShape>> {
  return (value, path) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return fail(path, "an object", value);
    }

    const properties = new Map<string, unknown>(Object.entries(value));
    const result = Object.fromEntries(
      Object.entries(shape).map(([key, schema]) => [
        key,
        schema(properties.get(key), path === "" ? key : `${path}.${key}`),
      ]),
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Every property of the shape was just checked against its schema, which TypeScript can't follow through `Object.fromEntries`.
    return result as ObjectOutput<TShape>;
  };
}

/**
 * Allows a value to be omitted or explicitly `undefined`.
 *
 * @param schema Schema of the value when it's there.
 * @returns The schema.
 */
function optional<TOutput, TInput>(
  schema: Schema<TOutput, TInput>,
): Schema<TOutput | undefined, TInput | undefined> {
  return (value, path) =>
    value === undefined ? undefined : schema(value, path);
}

/**
 * Adds source context, such as `GitHub API GET /user`, to schema failures.
 *
 * @param schema Schema to validate the value with.
 * @param value Value to validate.
 * @param label Where the value comes from, for the error message.
 * @returns The validated value.
 */
function parse<TOutput>(
  schema: Schema<TOutput, unknown>,
  value: unknown,
  label: string,
): TOutput {
  try {
    return schema(value, "");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`${label} returned an unexpected value: ${message}`, {
      cause: error,
    });
  }
}

export type { Infer, Input, Schema };
export { array, boolean, number, object, optional, parse, string, url };
