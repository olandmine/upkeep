import { X } from 'lucide-react'
import { useId, useState, type KeyboardEvent } from 'react'
import { Input } from '../ui/Input'

const MAX_TAGS = 6

export function TagEditor({
  tags,
  suggestions,
  onAdd,
  onRemove,
}: {
  tags: string[]
  suggestions: string[]
  onAdd: (label: string) => void
  onRemove: (label: string) => void
}) {
  const [draft, setDraft] = useState('')
  const listId = useId()
  const full = tags.length >= MAX_TAGS

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const label = draft.trim()
    if (label && !tags.includes(label)) onAdd(label)
    setDraft('')
  }

  return (
    <div className="flex flex-col gap-2">
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <li key={t} className="type-caption flex h-6 items-center gap-1 rounded-full bg-elevated pr-1 pl-2.5 text-fg">
              {t}
              <button
                type="button"
                aria-label={`Remove tag ${t}`}
                onClick={() => onRemove(t)}
                className="flex size-4 items-center justify-center rounded-full text-fg-3 hover:bg-line-2 hover:text-fg"
              >
                <X aria-hidden size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        aria-label="Add tag"
        placeholder={full ? undefined : 'Add a tag and press Enter'}
        list={listId}
        disabled={full}
        value={draft}
        maxLength={50}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <datalist id={listId}>
        {suggestions
          .filter((s) => !tags.includes(s))
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
      {full && <p className="type-caption text-fg-3">Up allows up to 6 tags per transaction.</p>}
    </div>
  )
}
