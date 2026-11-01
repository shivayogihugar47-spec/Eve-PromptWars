import type { AssistantCard, QuickOption } from "@/app/api/chat/route";
import { BUDGET_OPTIONS } from "@/lib/budget";

export interface EventChatMessage {
  role: string;
  content: string;
}

export interface EventCollectedData {
  eventType: string | null;
  eventDate: string | null;
  guestCount: string | null;
  city: string | null;
  budgetTotal: string | null;
  accessibilityNeeds: string | null;
  ageMix: string | null;
  theme: string | null;
  venueStyle: string | null;
  cateringType: string | null;
  specialRequirements: string | null;
  eventDetails: Record<string, string | null>;
}

export interface EventQuestion extends Omit<AssistantCard, "step"> {
  key: keyof Omit<EventCollectedData, "eventDetails"> | `eventDetails.${string}`;
  label: string;
  step: number;
}

const eventTypeOptions: QuickOption[] = [
  { label: "Wedding", value: "wedding" },
  { label: "Birthday", value: "birthday" },
  { label: "Community Event", value: "community" },
  { label: "Corporate", value: "corporate" },
  { label: "Festival", value: "festival" },
  { label: "Other", value: "other" },
];

const eventTypeLabels: Record<string, string> = {
  wedding: "Wedding",
  birthday: "Birthday",
  community: "Community event",
  corporate: "Corporate event",
  festival: "Festival",
  other: "Event",
};

const sharedQuestions: Omit<EventQuestion, "step">[] = [
  {
    key: "eventType",
    label: "Occasion",
    title: "What are you celebrating?",
    subtitle: "Hi! I'm Eve. Let's plan something extraordinary together.",
    options: eventTypeOptions,
  },
  {
    key: "eventDate",
    label: "Date",
    title: "When is the big day?",
    subtitle: "A wonderful choice. Let's find the right date.",
    inputType: "date",
  },
  {
    key: "guestCount",
    label: "Guest list",
    title: "How many people are you expecting?",
    subtitle: "Knowing the scale helps shape the whole plan.",
    options: ["Under 50", "50–100", "100–200", "200–500", "500+"].map((label) => ({ label, value: label })),
  },
  {
    key: "city",
    label: "City",
    title: "Where will it take place?",
    subtitle: "I'll tailor the recommendations to your location.",
    inputPlaceholder: "e.g. Bengaluru, Mumbai, Delhi",
    inputType: "text",
  },
  {
    key: "budgetTotal",
    label: "Budget",
    title: "What's your total budget range?",
    subtitle: "This helps make every part of the plan realistic.",
    options: BUDGET_OPTIONS,
  },
];

const guestExperienceQuestions: Omit<EventQuestion, "step">[] = [
  {
    key: "accessibilityNeeds",
    label: "Accessibility & dietary needs",
    title: "What accessibility or dietary needs should we plan for?",
    subtitle: "Tell us what guests need to feel comfortable and included; you can list more than one need.",
    inputPlaceholder: "E.g. wheelchair access, step-free routes, seating for elderly guests, dietary restrictions...",
    inputType: "text",
  },
  {
    key: "ageMix",
    label: "Age mix",
    title: "What is the age mix of your guests?",
    subtitle: "This helps us suggest activities and food that suit the whole group.",
    options: ["Mostly children", "Mostly teens and young adults", "Mostly adults", "Mostly older adults", "A mix of ages", "All ages represented"].map((label) => ({ label, value: label })),
  },
];

const optionQuestion = (
  key: `eventDetails.${string}` | keyof EventCollectedData,
  label: string,
  title: string,
  subtitle: string,
  options: string[],
): Omit<EventQuestion, "step"> => ({
  key: key as EventQuestion["key"],
  label,
  title,
  subtitle,
  options: options.map((value) => ({ label: value, value })),
});

const textQuestion = (
  key: `eventDetails.${string}` | keyof EventCollectedData,
  label: string,
  title: string,
  subtitle: string,
  inputPlaceholder: string,
): Omit<EventQuestion, "step"> => ({
  key: key as EventQuestion["key"],
  label,
  title,
  subtitle,
  inputPlaceholder,
  inputType: "text",
});

const occasionQuestions: Record<string, Omit<EventQuestion, "step">[]> = {
  wedding: [
    optionQuestion("eventDetails.ceremonyStyle", "Ceremony", "What kind of ceremony are you planning?", "We can shape the day around the traditions that matter to you.", ["Hindu", "Muslim", "Christian", "Sikh", "Civil", "Interfaith / blended", "Not decided"]),
    optionQuestion("theme", "Style", "What feeling should the celebration have?", "Choose a style that feels like the two of you.", ["Classic & elegant", "Modern & minimal", "Garden celebration", "Vibrant & colorful", "Destination wedding", "Royal & grand"]),
    optionQuestion("venueStyle", "Venue", "Where do you picture saying 'I do'?", "The setting helps guide the guest experience and logistics.", ["Banquet hall", "Outdoor garden", "Heritage property", "Resort / destination", "At home", "Not decided"]),
    optionQuestion("cateringType", "Catering", "What should the wedding menu include?", "We'll keep the food plan aligned with your guests and traditions.", ["Vegetarian", "Non-vegetarian", "Both veg & non-veg", "Regional wedding feast", "Not decided"]),
    textQuestion("specialRequirements", "Personal touches", "What moments or traditions must be included?", "Add rituals, accessibility needs, surprises, or anything personal.", "E.g. baraat, live band, accessible seating..."),
  ],
  corporate: [
    optionQuestion("eventDetails.format", "Format", "What kind of business event is it?", "The format determines the run of show and production needs.", ["Conference", "Product launch", "Team offsite", "Networking event", "Training / workshop", "Company celebration", "Client meeting"]),
    optionQuestion("eventDetails.objective", "Objective", "What is the main outcome you want?", "We'll prioritize the moments that make the event successful.", ["Share knowledge", "Launch a product", "Build team connection", "Generate leads", "Recognize achievements", "Align on strategy"]),
    optionQuestion("eventDetails.duration", "Duration", "How long should the program run?", "This gives the agenda a realistic rhythm.", ["Half day", "Full day", "Multiple days", "Evening event"]),
    optionQuestion("venueStyle", "Venue", "What setting suits the event?", "Think about access, capacity, and the kind of energy you want.", ["Hotel / conference center", "Office", "Convention venue", "Outdoor venue", "Hybrid venue", "Not decided"]),
    textQuestion("eventDetails.productionNeeds", "AV & production", "What technology or production will you need?", "We'll plan for the right sound, screens, and remote participation.", "E.g. stage, microphones, livestream, breakout rooms..."),
  ],
  birthday: [
    textQuestion("eventDetails.honoree", "Guest of honor", "Who are we celebrating, and what age are they turning?", "A few details help make the celebration feel personal.", "Name and age (optional)"),
    optionQuestion("theme", "Party style", "What kind of birthday energy are you after?", "Pick the mood and we'll build around it.", ["Intimate dinner", "Big dance party", "Family-friendly", "Outdoor picnic", "Themed adventure", "Surprise celebration"]),
    optionQuestion("venueStyle", "Venue", "Where should the party happen?", "We'll match the setting to your guests and party style.", ["At home", "Restaurant", "Party venue", "Garden / outdoor", "Activity venue", "Not decided"]),
    optionQuestion("eventDetails.entertainment", "Entertainment", "What will make the guests light up?", "Choose the main activity; you can add more in the final notes.", ["DJ / dancing", "Live music", "Games & activities", "Kids' entertainment", "Dinner & conversation", "Surprise moment"]),
    optionQuestion("cateringType", "Food", "What kind of food should we plan for?", "We'll account for the kind of gathering and your guests.", ["Buffet", "Sit-down meal", "Snacks & dessert", "Cake-focused party", "Mixed menu", "Not decided"]),
  ],
  community: [
    optionQuestion("eventDetails.purpose", "Purpose", "What is the community coming together for?", "The purpose will guide the schedule and local partnerships.", ["Cultural celebration", "Fundraiser", "Neighborhood gathering", "Public awareness", "Community workshop", "Seasonal celebration"]),
    textQuestion("eventDetails.audience", "Community", "Who is this event for?", "We'll make the format welcoming for the people you want to reach.", "E.g. local families, students, neighborhood groups..."),
    optionQuestion("eventDetails.participation", "Activities", "How should people take part?", "A good community event makes it easy to join in.", ["Performances", "Hands-on workshops", "Market / stalls", "Games & activities", "Talks / presentations", "Shared meal"]),
    optionQuestion("venueStyle", "Venue", "What kind of community space do you have in mind?", "Access and capacity are especially important for public gatherings.", ["Community hall", "Park / open space", "School / campus", "Street / public square", "Place of worship", "Not decided"]),
    textQuestion("specialRequirements", "Access & needs", "What would help everyone feel included?", "Consider accessibility, language, safety, and dietary needs.", "E.g. step-free access, translation, quiet area..."),
  ],
  festival: [
    textQuestion("eventDetails.festival", "Festival", "Which festival or seasonal occasion is it?", "We'll make the plan fit its traditions and timing.", "Festival name or occasion"),
    optionQuestion("eventDetails.program", "Program", "What will be the heart of the festival?", "Pick the anchor activity; other details can go in the final notes.", ["Live performances", "Rituals / ceremony", "Food & market", "Parade / procession", "Arts & workshops", "Family activities"]),
    optionQuestion("eventDetails.duration", "Duration", "How long will the festival run?", "The duration shapes staffing, schedule, and site logistics.", ["One evening", "One day", "A full weekend", "Several days"]),
    optionQuestion("venueStyle", "Site", "What kind of site are you planning for?", "We'll account for crowd flow and site facilities.", ["Outdoor grounds", "Street / public square", "Community venue", "Temple / cultural site", "Multiple venues", "Not decided"]),
    textQuestion("eventDetails.operations", "Site operations", "Any crowd, safety, or infrastructure needs?", "Share expected setup needs so operations are part of the plan.", "E.g. stages, power, crowd control, sanitation..."),
  ],
  other: [
    optionQuestion("eventDetails.purpose", "Purpose", "What should this gathering accomplish?", "The goal helps us choose the right shape for the day.", ["Celebrate a milestone", "Bring people together", "Share an idea", "Raise funds", "Host clients", "Something else"]),
    optionQuestion("theme", "Style", "What atmosphere feels right?", "Choose a starting point; your own words work too in the final notes.", ["Relaxed & intimate", "Polished & formal", "Playful & colorful", "Creative & unexpected", "Outdoor & natural", "Not decided"]),
    optionQuestion("venueStyle", "Venue", "What kind of setting do you prefer?", "We'll use this to guide venue and logistics suggestions.", ["At home", "Hotel / restaurant", "Outdoor space", "Community venue", "Unique / destination", "Not decided"]),
    optionQuestion("eventDetails.experience", "Experience", "What should guests spend their time doing?", "We'll shape the flow around the experience you want.", ["Conversation & dining", "Performances", "Hands-on activities", "Presentations", "Games & entertainment", "A mix of everything"]),
    textQuestion("specialRequirements", "Special touches", "Anything else we should keep in mind?", "Share practical needs or the detail that will make it yours.", "E.g. accessibility, dietary needs, surprises..."),
  ],
};

const EVENT_TYPES = Object.keys(eventTypeLabels);

function normalizeEventType(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  return EVENT_TYPES.find((type) => normalized.includes(type)) ?? null;
}

export function getEventQuestionFlow(eventType: string | null | undefined): EventQuestion[] {
  const normalizedType = normalizeEventType(eventType ?? undefined);
  const questions = [
    ...sharedQuestions,
    ...(normalizedType ? occasionQuestions[normalizedType] : occasionQuestions.other),
    ...guestExperienceQuestions,
  ];
  return questions.map((question, index) => ({ ...question, step: index + 1 }));
}

function toAssistantCard(question: EventQuestion): AssistantCard {
  return {
    step: question.step,
    title: question.title,
    subtitle: question.subtitle,
    hint: question.hint,
    options: question.options,
    inputType: question.inputType,
    inputPlaceholder: question.inputPlaceholder,
  };
}

function createCollectedData(): EventCollectedData {
  return {
    eventType: null,
    eventDate: null,
    guestCount: null,
    city: null,
    budgetTotal: null,
    accessibilityNeeds: null,
    ageMix: null,
    theme: null,
    venueStyle: null,
    cateringType: null,
    specialRequirements: null,
    eventDetails: {},
  };
}

function setAnswer(data: EventCollectedData, key: EventQuestion["key"], value: string) {
  if (key.startsWith("eventDetails.")) {
    data.eventDetails[key.slice("eventDetails.".length)] = value;
  } else {
    const field = key as keyof Omit<EventCollectedData, "eventDetails">;
    data[field] = value;
  }
}

function extractInitialEventType(message: string): string | null {
  const preselected = message.match(/^I want to plan a (.+)$/i);
  return normalizeEventType(preselected?.[1] ?? message);
}

export function buildNextEventQuestion(messages: EventChatMessage[]) {
  const userMessages = messages.filter((message) => message.role === "user").map((message) => message.content.trim());
  const firstUserMessage = userMessages[0] ?? "";
  const selectedType = extractInitialEventType(firstUserMessage);
  const data = createCollectedData();

  if (!selectedType) {
    const flow = getEventQuestionFlow(null);
    return {
      card: toAssistantCard(flow[0]),
      readyToGenerate: false,
      collectedData: data,
    };
  }

  data.eventType = selectedType;
  const flow = getEventQuestionFlow(selectedType);
  const answers = userMessages.slice(1);
  const followupQuestions = flow.slice(1);
  answers.slice(0, followupQuestions.length).forEach((answer, index) => {
    setAnswer(data, followupQuestions[index].key, answer);
  });

  const nextQuestion = followupQuestions[answers.length];
  if (!nextQuestion) {
    return { readyToGenerate: true, collectedData: data };
  }

  const subtitle = nextQuestion.key === "budgetTotal" && data.city
    ? `I'll make sure every rupee is well-spent in ${data.city}.`
    : nextQuestion.key === "accessibilityNeeds"
      ? "We'll use these needs to guide venue access, seating, and the menu."
      : nextQuestion.key === "ageMix"
        ? "I'll tailor menu ideas and activities to the ages in your group."
    : nextQuestion.key === "eventDate"
      ? `${eventTypeLabels[selectedType]}! A wonderful choice. Let's find the right date.`
      : nextQuestion.subtitle;

  return {
    card: toAssistantCard({ ...nextQuestion, subtitle }),
    readyToGenerate: false,
    collectedData: data,
  };
}