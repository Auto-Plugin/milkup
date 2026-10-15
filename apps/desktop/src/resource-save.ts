/** Copy resources before writing Markdown. Once Markdown commits, cleanup must
 * never delete its referenced files, even if the final acknowledgement fails. */
export async function saveWithResources<T>(options: {
  prepare(): Promise<{ readonly id: string } | undefined>
  write(): Promise<T>
  accept(id: string): Promise<void>
  abort(id: string): Promise<void>
  report(error: unknown): void
}): Promise<T> {
  const prepared = await options.prepare()
  let result: T
  try {
    result = await options.write()
  } catch (error) {
    if (prepared) await options.abort(prepared.id).catch(options.report)
    throw error
  }
  if (prepared) await options.accept(prepared.id).catch(options.report)
  return result
}
