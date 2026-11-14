
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeItemIcon, readItemIconDefinitions, verifyItemIcon } from './item-icon-publisher.mjs'

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))

/** 先完成全部合成与校验，任何缺图或错误尺寸都在写入前失败。 */
export async function refreshBottledIcons({
  registryFile = path.join(projectRoot, 'src/registry/item-definition.ts'),
  iconDirectory = path.join(projectRoot, 'public/item-icons'),
  provenanceFile,
} = {}) {
  const items = await readItemIconDefinitions(registryFile)
  const byId = new Map(items.map(item => [item.id, item]))
  const outputs = []
  for (const item of items.filter(item => item.containerId)) {
    const containerIconId = byId.get(item.containerId).iconId
    const contentIconId = byId.get(item.contentId).iconId
    const container = await readFile(path.join(iconDirectory, containerIconId + '.webp'))
    const content = await readFile(path.join(iconDirectory, contentIconId + '.webp'))
    await verifyItemIcon(container)
    await verifyItemIcon(content)
    const bytes = await composeItemIcon(container, content)
    await verifyItemIcon(bytes)
    outputs.push({ iconId: item.iconId, bytes, containerIconId, contentIconId })
  }
  const receipt = provenanceFile ? JSON.parse(await readFile(provenanceFile, 'utf8')) : undefined
  for (const output of outputs) {
    if (receipt) {
      const record = receipt.outputs.find(record => record.iconId === output.iconId)
      if (!record || record.kind !== 'composite' || record.containerIconId !== output.containerIconId
        || record.contentIconId !== output.contentIconId) throw new Error('合成映射已变化，请使用 sync-item-icons.mjs 重新生成完整收据')
      record.bytes = output.bytes.length
      record.sha256 = createHash('sha256').update(output.bytes).digest('hex')
    }
  }
  for (const output of outputs) await writeFile(path.join(iconDirectory, output.iconId + '.webp'), output.bytes)
  if (receipt) await writeFile(provenanceFile, JSON.stringify(receipt, null, 2) + '\n')
  return { generated: outputs.length }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  refreshBottledIcons({ provenanceFile: path.join(projectRoot, 'resources/item-icon-provenance.json') })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error); process.exitCode = 1 })
}
