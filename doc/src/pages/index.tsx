import type { ReactNode } from 'react';
import clsx from 'clsx';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import DocsSitemap from '@site/src/components/DocsSitemap';
import styles from './index.module.css';

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  const logoUrl = useBaseUrl('/img/logo.svg');
  return (
    <Layout title={siteConfig.title}>
      <main className={clsx(styles.main)}>
        <div className={styles.twoColLayout}>
          {/* Left Column - Fixed width, scroll-fixed */}
          <aside className={styles.leftCol}>
            <div className={styles.leftColContent}>
              {/* Title and Logo Section */}
              <div className={styles.headerSection}>
                <h1>{siteConfig.title}</h1>
                <p className={styles.tagline}>{siteConfig.tagline}</p>

                {/* Big Logo */}
                <div className={styles.logoContainer}>
                  <img src={logoUrl} alt="mdx-formatter Logo" className={styles.bigLogo} />
                </div>
              </div>

              {/* Quick Links */}
              <section className={styles.linksSection}>
                <h2>Related Links</h2>
                <ul className={styles.linksList}>
                  <li>
                    <a href="https://github.com/Takazudo/mdx-formatter" rel="noopener noreferrer">
                      GitHub Repository
                    </a>
                  </li>
                  <li>
                    <a href="https://www.npmjs.com/package/mdx-formatter" rel="noopener noreferrer">
                      npm Package
                    </a>
                  </li>
                </ul>
              </section>
            </div>
          </aside>

          {/* Right Column - Remaining space */}
          <div className={styles.rightCol}>
            {/* Full Documentation Sitemap */}
            <DocsSitemap />
          </div>
        </div>
      </main>
    </Layout>
  );
}
