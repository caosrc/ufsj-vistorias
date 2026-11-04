import styles from './Portal.module.css'

export default function PortalLayout({ children, section = 'Portal do cidadão', title = 'Informação clara também protege.', description = 'Um canal seguro para aproximar moradores e Defesa Civil.', note = 'Ouro Branco e Congonhas' }) {
  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a className={styles.brand} href="/" aria-label="SISMAR — página inicial" data-testid="link-sismar-home">
          <span className={styles.brandMark} aria-hidden="true"><span /></span>
          <span className={styles.brandText}>
            <strong>SISMAR</strong>
            <small>Defesa Civil municipal</small>
          </span>
        </a>
        <div className={styles.region}><span className={styles.regionDot} />{note}</div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.story}>
          <div className={styles.storyContent}>
            <div className={styles.storyKicker}><span className={styles.kickerLine} />{section}</div>
            <h1>{title}</h1>
            <p className={styles.storyDescription}>{description}</p>
            <div className={styles.storyRule} />
            <p className={styles.storyFoot}>Prevenção começa com escuta, cuidado e informação de quem vive aqui.</p>
          </div>
          <div className={styles.mapMotif} aria-hidden="true">
            <span className={styles.contour contourOne} />
            <span className={styles.contour contourTwo} />
            <span className={styles.contour contourThree} />
            <span className={styles.mapPin}><i /></span>
            <span className={styles.mapCaption}>Território · comunidade · cuidado</span>
          </div>
          <div className={styles.storyFooter}>
            <span>Serviço público, feito perto de você.</span>
            <span className={styles.footerMark}>S / 01</span>
          </div>
        </aside>

        <section className={styles.mainPanel}>
          <div className={styles.panelTopline}>
            <span className={styles.panelLabel}>{section}</span>
            <span className={styles.secureLabel}><span aria-hidden="true" /> Ambiente protegido</span>
          </div>
          {children}
          <footer className={styles.panelFooter}>
            <span>Seus dados são tratados com respeito e responsabilidade.</span>
            <span>© SISMAR · Defesa Civil</span>
          </footer>
        </section>
      </div>
    </main>
  )
}
