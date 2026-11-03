import { supabase, supabaseDisponivel } from '../operacional/supabaseClient'

export const SUPABASE_MEDIA_BUCKET = 'defesa-civil-private'

export type MediaOwner = {
  entidade: string
  entidadeId: string
  campo?: string
  metadata?: Record<string, unknown>
}

export function storagePathFromUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  if (value.startsWith('storage://')) return value.slice('storage://'.length)
  try {
    const url = new URL(value)
    const marker = `/storage/v1/object/sign/${SUPABASE_MEDIA_BUCKET}/`
    const publicMarker = `/storage/v1/object/public/${SUPABASE_MEDIA_BUCKET}/`
    const markerIndex = url.pathname.indexOf(marker)
    const publicIndex = url.pathname.indexOf(publicMarker)
    const index = markerIndex >= 0 ? markerIndex + marker.length
      : publicIndex >= 0 ? publicIndex + publicMarker.length
        : -1
    return index >= 0 ? decodeURIComponent(url.pathname.slice(index)) : null
  } catch {
    return null
  }
}

function mimeExtension(contentType: string) {
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/jpeg') return 'jpg'
  if (contentType === 'application/pdf') return 'pdf'
  return 'webp'
}

export async function uploadDataUrl(value: string, owner: MediaOwner): Promise<string> {
  const existingPath = storagePathFromUrl(value)
  if (existingPath) return `storage://${existingPath}`
  if (!value.startsWith('data:')) return value
  if (!supabaseDisponivel) throw new Error('Supabase não está configurado para enviar arquivos.')

  const response = await fetch(value)
  if (!response.ok) throw new Error('Não foi possível preparar o arquivo para envio.')
  const file = await response.blob()
  const contentType = file.type || 'image/webp'
  const extension = mimeExtension(contentType)
  const unique = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const path = `${owner.entidade}/${encodeURIComponent(owner.entidadeId)}/${unique}.${extension}`

  const { error: uploadError } = await supabase.storage
    .from(SUPABASE_MEDIA_BUCKET)
    .upload(path, file, { contentType, upsert: false })
  if (uploadError) throw new Error(`Falha ao enviar arquivo: ${uploadError.message}`)

  const { error: metadataError } = await supabase.from('arquivos_app').insert({
    entidade: owner.entidade,
    entidade_id: owner.entidadeId,
    campo: owner.campo || 'foto',
    bucket_id: SUPABASE_MEDIA_BUCKET,
    storage_path: path,
    metadata: owner.metadata || {},
  })
  if (metadataError) {
    await supabase.storage.from(SUPABASE_MEDIA_BUCKET).remove([path]).catch(() => {})
    throw new Error(`Falha ao registrar arquivo: ${metadataError.message}`)
  }

  return `storage://${path}`
}

export async function resolveMediaUrl(value: unknown): Promise<string> {
  if (typeof value !== 'string' || !value) return ''
  const path = storagePathFromUrl(value)
  if (!path) return value
  if (!supabaseDisponivel) return ''

  const { data, error } = await supabase.storage
    .from(SUPABASE_MEDIA_BUCKET)
    .createSignedUrl(path, 60 * 60)
  if (error) throw new Error(`Falha ao abrir arquivo armazenado: ${error.message}`)
  return data.signedUrl
}

export async function saveMediaList(
  values: unknown[],
  owner: MediaOwner,
): Promise<string[]> {
  if (!Array.isArray(values)) return []
  return Promise.all(values.map((value, index) => uploadDataUrl(
    typeof value === 'string' ? value : '',
    { ...owner, metadata: { ...(owner.metadata || {}), index } },
  )))
}

export async function resolveMediaList(values: unknown[]): Promise<string[]> {
  if (!Array.isArray(values)) return []
  return Promise.all(values.map(resolveMediaUrl))
}

export async function deleteEntityMedia(entidade: string, entidadeId: string) {
  if (!supabaseDisponivel) return
  const { data, error } = await supabase
    .from('arquivos_app')
    .select('id,storage_path')
    .eq('entidade', entidade)
    .eq('entidade_id', entidadeId)
  if (error) throw new Error(`Falha ao consultar arquivos: ${error.message}`)
  const rows = data || []
  if (!rows.length) return

  const paths = rows.map((row) => row.storage_path).filter(Boolean)
  if (paths.length) {
    const { error: storageError } = await supabase.storage.from(SUPABASE_MEDIA_BUCKET).remove(paths)
    if (storageError) throw new Error(`Falha ao excluir arquivos: ${storageError.message}`)
  }
  const { error: rowsError } = await supabase.from('arquivos_app').delete().in('id', rows.map((row) => row.id))
  if (rowsError) throw new Error(`Falha ao excluir metadados de arquivos: ${rowsError.message}`)
}
