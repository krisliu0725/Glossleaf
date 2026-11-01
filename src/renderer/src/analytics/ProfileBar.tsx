import {useState} from 'react'
import {ui,useUsername} from '../i18n'
export default function ProfileBar({ fallback, note, rename }: { fallback: string; note: string; rename: string }): React.ReactElement {
  const [name, setName] = useUsername()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const display = name || fallback

  const commit = (): void => {
    setName(draft)
    setEditing(false)
  }

  return (
    <section className="dash-profile" aria-label={ui("本地账户")}>
      <span className="dash-profile__avatar" aria-hidden="true">
        {display.slice(0, 1)}
      </span>
      <div className="dash-profile__body">
        <h2 className="dash-profile__name">
          {editing ? (
            <input
              autoFocus
              value={draft}
              maxLength={24}
              aria-label={ui("用户名")}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') {
                  setDraft(name)
                  setEditing(false)
                }
              }}
            />
          ) : (
            display
          )}
        </h2>
        <p className="dash-profile__meta">{note}</p>
      </div>
      <div className="dash-profile__actions">
        {editing ? (
          <button className="btn" onClick={commit}>
            {ui("保存")}</button>
        ) : (
          <button
            className="btn"
            onClick={() => {
              setDraft(name)
              setEditing(true)
            }}
          >
            {rename}
          </button>
        )}
      </div>
    </section>
  )
}

