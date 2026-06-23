import MonitoramentoLayout from '../components/MonitoramentoLayout'
import styles from './MonitoramentoSobre.module.css'

export default function MonitoramentoSobre() {
  return (
    <MonitoramentoLayout>
      <div className={styles.container}>
        <h1 className={styles.title}>Sobre / Suporte</h1>
        <div className={styles.card}>
          <h2 className={styles.sectionTitle}>GEO-Vistorias</h2>
          <p className={styles.desc}>Sistema de monitoramento geotécnico para vistorias de imóveis em Ouro Branco e Congonhas - MG.</p>
          <div className={styles.divider} />
          <h3 className={styles.sectionTitle}>Suporte</h3>
          <p className={styles.desc}>Para suporte, entre em contato com Sócrates Resende.</p>
          <div className={styles.contactList}>
            <div className={styles.contactItem}>
              <span className={styles.contactLabel}>E-mail:</span>
              <a href="mailto:socrates.resende@gmail.com" className={styles.contactValue}>socrates.resende@gmail.com</a>
            </div>
          </div>
        </div>
      </div>
    </MonitoramentoLayout>
  )
}
