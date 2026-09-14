import { Service } from '@rabjs/react';
import type { CardDetail, CardLinksResponse } from '@inwit/dto';
import { deleteCardLink, getCard, getCardLinks } from '@/api/cards';
import { errorMessage } from '@/api/client';
import { groupCardLinks, uniqueRelatedCount, type RelatedGroup } from '@/lib/card-copy';

export class CardPageService extends Service {
  card: CardDetail | null = null;
  links: CardLinksResponse | null = null;
  error: string | null = null;
  deletingId: string | null = null;
  loadedId: string | null = null;

  get groups(): RelatedGroup[] {
    if (!this.links) return [];
    return groupCardLinks(this.links);
  }

  get relatedCount(): number {
    if (!this.links) return 0;
    return uniqueRelatedCount(this.links);
  }

  async load(id: string): Promise<void> {
    this.error = null;
    if (this.loadedId !== id) {
      this.card = null;
      this.links = null;
      this.loadedId = id;
    }
    try {
      const [card, links] = await Promise.all([getCard(id), getCardLinks(id)]);
      if (this.loadedId !== id) return;
      this.card = card;
      this.links = links;
    } catch (err) {
      if (this.loadedId !== id) return;
      this.error = errorMessage(err, '打不开这张卡');
      this.card = null;
      this.links = null;
    }
  }

  async removeLink(linkId: string): Promise<void> {
    if (this.deletingId) return;
    this.deletingId = linkId;
    this.error = null;
    try {
      await deleteCardLink(linkId);
      if (!this.links) return;
      this.links = {
        outgoing: this.links.outgoing.filter((link) => link.id !== linkId),
        incoming: this.links.incoming.filter((link) => link.id !== linkId),
      };
    } catch (err) {
      this.error = errorMessage(err, '没删掉这条关联');
    } finally {
      this.deletingId = null;
    }
  }
}
