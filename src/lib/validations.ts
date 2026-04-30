import z from "zod";
import qs from "qs";
import type relations from "../db/relations.js";

function getRelationsFor(
    fullRelations: typeof relations,
    entityName: keyof typeof relations,
): typeof relations {
    const entity = fullRelations[entityName];
    if (!entity) return {} as typeof relations;
    return (entity.relations ?? entity) as unknown as typeof relations;
}

export function withSchema(
    fullRelations: typeof relations,
    entityName: keyof typeof relations,
): any {
    const rels = getRelationsFor(fullRelations, entityName);
    const relationKeys = Object.keys(rels);

    if (relationKeys.length === 0) {
        return z.record(z.never(), z.never()).optional();
    }

    const relationValueSchema = (key: keyof typeof relations) =>
        z
            .union([
                z.enum(["true", "false"]).transform((val: string) => val === "true"),
                z
                    .object({
                        with: z.lazy(() => withSchema(fullRelations, key)),
                    })
                    .strict(),
            ])
            .optional();

    return z
        .object(
            Object.fromEntries(
                relationKeys.map((key) => [key, relationValueSchema(key as keyof typeof relations)]),
            ) as Record<string, z.ZodTypeAny>,
        )
        .strict()
        .optional();
}

export function querySchema<T extends z.ZodTypeAny>(
    schema: T,
): z.ZodType<z.output<T>, string> {
    return z.preprocess((val: string) => qs.parse(val), schema);
}
