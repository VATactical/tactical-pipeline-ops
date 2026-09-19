alter table public.training_modules
  add column if not exists title_es text,
  add column if not exists title_en text,
  add column if not exists description_es text,
  add column if not exists description_en text;

alter table public.training_items
  add column if not exists title_es text,
  add column if not exists title_en text,
  add column if not exists description_es text,
  add column if not exists description_en text;

update public.training_modules
set title_es = coalesce(title_es, title),
    title_en = coalesce(title_en, title),
    description_es = coalesce(description_es, description, ''),
    description_en = coalesce(description_en, description, '');

with module_copy(sort_order, title_es, title_en, description_es, description_en) as (values
  (0, 'Empieza aquí — Cultura, reglas y objetivo', 'Start here — Culture, rules, and goals', 'Visión, reglas no negociables, seguridad de cuentas y check-in diario.', 'Vision, non-negotiable rules, account security, and daily check-in.'),
  (1, 'Módulo 1: Fundamentos de la agencia y oferta principal', 'Module 1: Agency Foundation & Core Offer', 'Modelo de negocio, mercado objetivo y garantía.', 'Business model, target market, and guarantee.'),
  (2, 'Módulo 2: Cultura operativa, velocidad y eficiencia de recursos', 'Module 2: Operational Culture, Speed & Asset Efficiency', 'Velocidad, comunicación y uso responsable de herramientas.', 'Speed, communication, and responsible use of tools.'),
  (3, 'Módulo 3: Posventa y onboarding del cliente', 'Module 3: Post-Sale & Client Onboarding', 'Onboarding, activos, pagos y accesos de Meta.', 'Onboarding, assets, payments, and Meta access.'),
  (4, 'Módulo 4: Creación técnica de subcuentas e infraestructura', 'Module 4: Technical Sub-Account & Infrastructure Build', 'Subcuentas, A2P, workflows, Make y Retell.', 'Sub-accounts, A2P, workflows, Make, and Retell.'),
  (5, 'Módulo 5: Personalización y estilos del funnel', 'Module 5: Funnel Customization & Custom Styling', 'Activos, conexiones, CSS y pruebas del funnel.', 'Assets, connections, CSS, and funnel testing.'),
  (6, 'Módulo 6: Producción creativa, lanzamiento y auditorías', 'Module 6: Ad Creative Production, Launch & Audits', 'Creativos, configuración, lanzamiento y auditoría de campañas.', 'Creative assets, setup, launch, and campaign audits.')
)
update public.training_modules m
set title_es = c.title_es,
    title_en = c.title_en,
    description_es = c.description_es,
    description_en = c.description_en
from module_copy c
where m.sort_order = c.sort_order;

update public.training_items
set title_es = coalesce(title_es, title),
    title_en = coalesce(title_en, title),
    description_es = coalesce(description_es, description, ''),
    description_en = coalesce(description_en, description, '');

with lesson_copy(module_order, item_order, title_es, title_en, description_es, description_en) as (values
  (0, 1, 'Visión, meta y KPI de la agencia', 'Agency vision, goal, and KPI', '12–20 citas agendadas por mes, servicio rápido, exacto y transparente.', '12–20 booked appointments per month with fast, accurate, and transparent service.'),
  (0, 2, 'Reglas no negociables y seguridad de cuentas', 'Non-negotiable rules and account security', 'No falsificar métricas, respetar límites de cuentas y no desperdiciar créditos.', 'Do not falsify metrics, respect account limits, and do not waste credits.'),
  (0, 3, 'Responsabilidades de Diego y Daniel', 'Diego and Daniel responsibilities', 'Handoff, comunicación y alcance operativo de cada rol.', 'Handoff, communication, and the operational scope of each role.'),
  (0, 4, 'EOD diario y revisión semanal del Training Hub', 'Daily EOD and weekly Training Hub review', 'Enviar el reporte antes de cerrar el día y revisar el hub al menos una vez por semana.', 'Submit the report before ending the day and review the hub at least once a week.'),
  (1, 1, 'Lección 1.1 — Modelo de negocio principal y propuesta de valor', 'Lesson 1.1 — Core Business Model & Value Proposition', '', ''),
  (1, 2, 'Lección 1.2 — Mercado objetivo y garantía de alto valor', 'Lesson 1.2 — Target Market & High-Ticket Guarantee', '', ''),
  (2, 1, 'Lección 2.1 — Ética de trabajo y velocidad de respuesta', 'Lesson 2.1 — Work Ethic & Speed-to-Lead', '', ''),
  (2, 2, 'Lección 2.2 — Protocolos de comunicación', 'Lesson 2.2 — Communication Protocols', 'WhatsApp, conversaciones de GHL y Slack.', 'WhatsApp, GHL Conversations, and Slack.'),
  (2, 3, 'Lección 2.3 — Eficiencia de créditos y gestión de recursos', 'Lesson 2.3 — Software Credit Efficiency & Asset Management', '', ''),
  (3, 1, 'Lección 3.1 — Llamada de onboarding en vivo', 'Lesson 3.1 — Live Onboarding Call', 'Guion y protocolo de pantalla compartida de 30–60 minutos.', 'Script and screen-sharing protocol for a 30–60 minute call.'),
  (3, 2, 'Lección 3.2 — Refacturación de GHL y pago de Meta', 'Lesson 3.2 — GHL Re-Billing & Meta Payment', '', ''),
  (3, 3, 'Lección 3.3 — Recopilación de recursos y carpeta del cliente', 'Lesson 3.3 — Asset Collection & Client Folder', 'EIN, datos, logos, medios, GHL y carpeta de cliente.', 'EIN, business details, logos, media, GHL, and the client folder.'),
  (3, 4, 'Lección 3.4 — Transferencia de accesos de Meta', 'Lesson 3.4 — Meta Access Handoff', 'Permisos de socio, página, cuenta publicitaria y pixel.', 'Partner permissions, Page, Ad Account, and Pixel.'),
  (4, 1, 'Lección 4.1 — Subcuenta y snapshot principal', 'Lesson 4.1 — Sub-Account & Master Snapshot', '', ''),
  (4, 2, 'Lección 4.2 — Dominio, SSL y calendario', 'Lesson 4.2 — Domain, SSL & Calendar', '', ''),
  (4, 3, 'Lección 4.3 — Workflows Big 5', 'Lesson 4.3 — Big 5 Workflows', 'Despliegue y pruebas.', 'Deployment and testing.'),
  (4, 4, 'Lección 4.4 — Escenarios de Make.com y webhooks', 'Lesson 4.4 — Make.com Scenarios & Webhooks', '', ''),
  (4, 5, 'Lección 4.5 — Agente de Retell AI y flujo de llamadas', 'Lesson 4.5 — Retell AI Agent & Call Flow', '', ''),
  (4, 6, 'Lección 4.6 — A2P 10DLC y envíos semanales', 'Lesson 4.6 — A2P 10DLC & Weekly Submissions', 'Páginas dummy, branding y 1–3 envíos proactivos por semana.', 'Dummy pages, branding, and 1–3 proactive submissions per week.'),
  (5, 1, 'Lección 5.1 — Carpeta multimedia y conexiones de GHL', 'Lesson 5.1 — GHL Media Folder & Connections', 'Google, Facebook, Instagram, reseñas y aplicaciones.', 'Google, Facebook, Instagram, Reviews, and Applications.'),
  (5, 2, 'Lección 5.2 — Gemini para CSS personalizado del funnel', 'Lesson 5.2 — Gemini for Custom Funnel CSS', '', ''),
  (5, 3, 'Lección 5.3 — Inyección de CSS y pruebas en vivo', 'Lesson 5.3 — CSS Injection & Live Testing', '', ''),
  (6, 1, 'Lección 6.1 — Ángulos publicitarios, voces y creativos con IA', 'Lesson 6.1 — Ad Angles, Voiceovers & AI Creative', '', ''),
  (6, 2, 'Lección 6.2 — Variaciones de imágenes estáticas', 'Lesson 6.2 — Static Image Variations', 'Lovart AI y HighLevel Ask AI.', 'Lovart AI and HighLevel Ask AI.'),
  (6, 3, 'Lección 6.3 — Edición rápida en CapCut', 'Lesson 6.3 — CapCut Rapid Editing', 'Límite operativo de 45 minutos.', '45-minute operating limit.'),
  (6, 4, 'Lección 6.4 — Meta Ads, UTM, Pixel y lanzamiento', 'Lesson 6.4 — Meta Ads, UTM, Pixel & Launch', 'Configuración, evento Lead y check-in diario.', 'Setup, Lead event, and daily check-in.'),
  (6, 5, 'Lección 6.5 — Optimización y auditoría de campañas', 'Lesson 6.5 — Campaign Optimization & Audits', 'Regla de 4 días sin cambios y aprobación antes del lanzamiento.', 'Four-day no-change rule and approval before launch.')
)
update public.training_items i
set title_es = c.title_es,
    title_en = c.title_en,
    description_es = c.description_es,
    description_en = c.description_en
from public.training_modules m, lesson_copy c
where i.module_id = m.id
  and m.sort_order = c.module_order
  and i.sort_order = c.item_order;

comment on column public.training_modules.title_es is 'Spanish display title for the training module';
comment on column public.training_modules.title_en is 'English display title for the training module';
comment on column public.training_items.title_es is 'Spanish display title for the training lesson';
comment on column public.training_items.title_en is 'English display title for the training lesson';
