import { Conversation, JerseyProduct, Message } from '../types';

export const MOCK_JERSEYS: JerseyProduct[] = [
  {
    id: 'j-1',
    league: 'Premier League',
    team: 'Arsenal',
    season: '2026/27',
    kitType: 'Away',
    title: 'Arsenal 26/27 Authentic Away Kit',
    imageUrl: 'https://images.unsplash.com/photo-1577223625816-7546f13df25d?auto=format&fit=crop&w=600&q=80',
    basePriceNgn: 45000,
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    inStock: true,
    description: 'Black and lynx gold detailing with breathable aeroready weave.'
  },
  {
    id: 'j-2',
    league: 'Premier League',
    team: 'Chelsea FC',
    season: '2026/27',
    kitType: 'Home',
    title: 'Chelsea 26/27 Vapor Match Home',
    imageUrl: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=600&q=80',
    basePriceNgn: 48000,
    sizes: ['M', 'L', 'XL'],
    inStock: true,
    description: 'Classic royal blue with iridescent 3D silicone crest.'
  },
  {
    id: 'j-3',
    league: 'La Liga',
    team: 'Real Madrid',
    season: '2026/27',
    kitType: 'Home',
    title: 'Real Madrid 26/27 Gold Trim Home Kit',
    imageUrl: 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=600&q=80',
    basePriceNgn: 50000,
    sizes: ['S', 'M', 'L', 'XL'],
    inStock: true,
    description: 'Iconic pure white textured fabric with metallic gold accents.'
  },
  {
    id: 'j-4',
    league: 'Serie A',
    team: 'AC Milan',
    season: '2026/27',
    kitType: 'Third',
    title: 'AC Milan 26/27 Olive Green Special Edition',
    imageUrl: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?auto=format&fit=crop&w=600&q=80',
    basePriceNgn: 42000,
    sizes: ['M', 'L', 'XL', 'XXL'],
    inStock: true,
    description: 'Sleek olive green and monochome silver crest.'
  }
];

export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: 'conv-1',
    customer: {
      id: 'cust-1',
      name: 'Nicholas Amazon',
      phone: '+234 801 573 8392',
      email: 'nicholasamazon@gmail.com',
      address: '225 Victoria Island, Lagos, NG',
      timeZone: 'Lagos, NG (GMT+1)',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
      stage: 'NEW LEAD',
      totalOrders: 3,
      totalSpendNgn: 135000,
      notes: 'VIP customer. Prefers player-issue slim fit. Always orders custom printing with Saka or Odegaard.',
      source: 'WhatsApp',
      createdAt: '23 Mar 2026'
    },
    topic: 'How can I order the 26/27 Arsenal Away with printing?',
    unreadCount: 2,
    lastMessageSnippet: 'Can someone help me check if Saka 7 is in stock for Size L?',
    lastMessageTime: '09:47 AM',
    isAiEnabled: true,
    assignedAgent: {
      id: 'agent-1',
      name: 'Maurice Robbins',
      role: 'Store Manager',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80'
    },
    activeOrder: {
      id: 'ord-1042',
      orderNumber: 1042,
      status: 'pending_payment',
      jerseyTitle: 'Arsenal 26/27 Authentic Away Kit (Size L)',
      size: 'L',
      customPrinting: {
        name: 'SAKA',
        number: '7',
        badge: 'UCL Starball'
      },
      amountNgn: 50000,
      stockHoldExpiresAt: new Date(Date.now() + 28 * 60 * 1000).toISOString(),
      shippingAddress: 'Plot 14, Admiralty Way, Lekki Phase 1, Lagos',
      courier: 'GIG Logistics'
    },
    mediaGallery: [
      {
        id: 'm-1',
        url: 'https://images.unsplash.com/photo-1577223625816-7546f13df25d?auto=format&fit=crop&w=400&q=80',
        type: 'image',
        caption: 'Arsenal Away Front'
      },
      {
        id: 'm-2',
        url: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=400&q=80',
        type: 'image',
        caption: 'Chelsea Home Back'
      },
      {
        id: 'm-3',
        url: 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=400&q=80',
        type: 'image',
        caption: 'Real Madrid Detail'
      }
    ]
  },
  {
    id: 'conv-2',
    customer: {
      id: 'cust-2',
      name: 'Ronald Fagelmon',
      phone: '+234 812 449 0192',
      email: 'ronald.fagelmon@outlook.com',
      address: '18 Wuse 2, Abuja, NG',
      timeZone: 'Abuja, NG (GMT+1)',
      avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80',
      stage: 'HOT LEAD',
      totalOrders: 1,
      totalSpendNgn: 48000,
      notes: 'Asked about Madrid gold edition for his brother.',
      source: 'WhatsApp',
      createdAt: '18 Mar 2026'
    },
    topic: 'Real Madrid 26/27 Gold Trim Size XL availability',
    unreadCount: 0,
    lastMessageSnippet: 'Let me show you how to apply custom font for the name',
    lastMessageTime: '09:48 AM',
    isAiEnabled: false,
    assignedAgent: {
      id: 'agent-1',
      name: 'Maurice Robbins',
      role: 'Store Manager',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80'
    },
    mediaGallery: []
  },
  {
    id: 'conv-3',
    customer: {
      id: 'cust-3',
      name: 'Logan Harrington',
      phone: '+234 903 881 2940',
      email: 'logan.h@gmail.com',
      address: 'Garki District, Abuja',
      timeZone: 'Abuja (GMT+1)',
      avatarUrl: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=200&q=80',
      stage: 'NEED FOLLOW UP',
      totalOrders: 0,
      totalSpendNgn: 0,
      notes: 'Inquired about retro 2006 Arsenal O2 jersey.',
      source: 'Instagram DM',
      createdAt: '15 Mar 2026'
    },
    topic: 'Retro jerseys inquiry',
    unreadCount: 1,
    lastMessageSnippet: 'Thank you! Waiting for your price confirmation.',
    lastMessageTime: '09:37 AM',
    isAiEnabled: true,
    assignedAgent: {
      id: 'agent-1',
      name: 'Maurice Robbins',
      role: 'Store Manager',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80'
    },
    mediaGallery: []
  },
  {
    id: 'conv-4',
    customer: {
      id: 'cust-4',
      name: 'Georgia Mollie',
      phone: '+234 809 332 1198',
      email: 'mollie.g@yahoo.com',
      address: 'Port Harcourt, Rivers State',
      timeZone: 'Port Harcourt (GMT+1)',
      avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80',
      stage: 'WAITING PAYMENT',
      totalOrders: 2,
      totalSpendNgn: 90000,
      notes: 'Sent Paystack link for Chelsea away kit. Awaiting payment notification.',
      source: 'WhatsApp',
      createdAt: '12 Mar 2026'
    },
    topic: 'Paystack payment link issued',
    unreadCount: 0,
    lastMessageSnippet: 'Thanks for your answer, paying via transfer shortly...',
    lastMessageTime: 'Yesterday',
    isAiEnabled: false,
    assignedAgent: {
      id: 'agent-1',
      name: 'Maurice Robbins',
      role: 'Store Manager',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80'
    },
    mediaGallery: []
  },
  {
    id: 'conv-5',
    customer: {
      id: 'cust-5',
      name: 'Leonard Campbell',
      phone: '+234 705 991 3821',
      email: 'campbell.leo@gmail.com',
      address: 'Ikeja GRA, Lagos',
      timeZone: 'Lagos (GMT+1)',
      avatarUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=200&q=80',
      stage: 'HOT LEAD',
      totalOrders: 5,
      totalSpendNgn: 245000,
      notes: 'Collector! Buys every AC Milan jersey every season.',
      source: 'WhatsApp',
      createdAt: '01 Mar 2026'
    },
    topic: 'Milan Olive kit pre-order',
    unreadCount: 0,
    lastMessageSnippet: 'Is the delivery within Lagos same day?',
    lastMessageTime: 'Yesterday',
    isAiEnabled: true,
    assignedAgent: {
      id: 'agent-1',
      name: 'Maurice Robbins',
      role: 'Store Manager',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80'
    },
    mediaGallery: []
  }
];

export const MOCK_MESSAGES_CONV1: Message[] = [
  {
    id: 'msg-1',
    conversationId: 'conv-1',
    sender: 'customer',
    direction: 'inbound',
    type: 'text',
    body: "Hey there! I want to order the new 2026/27 Arsenal away kit in Size L.",
    timestamp: '09:44 AM'
  },
  {
    id: 'msg-2',
    conversationId: 'conv-1',
    sender: 'customer',
    direction: 'inbound',
    type: 'text',
    body: "Can someone help me with this? Also want to know if custom printing with Saka 7 is possible?",
    timestamp: '09:45 AM'
  },
  {
    id: 'msg-3',
    conversationId: 'conv-1',
    sender: 'system',
    direction: 'outbound',
    type: 'system_alert',
    body: "This conversation is assigned to Maurice Robbins (Store Manager)",
    timestamp: '09:46 AM'
  },
  {
    id: 'msg-4',
    conversationId: 'conv-1',
    sender: 'agent',
    direction: 'outbound',
    type: 'text',
    body: "Hi Nicholas! Absolutely, we have the authentic player-issue Arsenal 26/27 Away in stock for Size L.",
    timestamp: '09:47 AM',
    deliveryStatus: 'read'
  },
  {
    id: 'msg-5',
    conversationId: 'conv-1',
    sender: 'agent',
    direction: 'outbound',
    type: 'interactive_kit',
    body: "Here is the exact kit overview and pricing directly from our catalog:",
    timestamp: '09:48 AM',
    deliveryStatus: 'read',
    kitData: {
      jersey: MOCK_JERSEYS[0],
      selectedSize: 'L',
      customName: 'SAKA',
      customNumber: '7',
      finalPriceNgn: 50000 // 45000 + 3000 printing + 2000 shipping
    }
  }
];
