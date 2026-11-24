/**
 * Content pack types - layout (split from types.ts).
 *
 * Groups: announcement-bar, navigation, footer.
 */

export type LayoutStrings = {
  announcementText: string;
  /** The announcement bar's arrows' accessible names. */
  announcePrevious: string;
  announceNext: string;

  navHome: string;
  navProducts: string;
  /** The phone menu button's accessible name. */
  navMenu: string;
  /** The phone menu's close button. */
  navMenuClose: string;

  footerAbout: string;
  footerQuickLinks: string;
  footerSupport: string;
  footerRights: string;
  /** The footer's WhatsApp button, when the store's widget has no label of its own. */
  footerWhatsapp: string;
  /** A social link's accessible name, by network, when the merchant gave it no label. */
  socialInstagram: string;
  socialFacebook: string;
  socialTiktok: string;
  socialYoutube: string;
};
