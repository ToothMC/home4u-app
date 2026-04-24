import { ChatView } from "@/components/chat/ChatView";

type SearchParams = Promise<{ flow?: string }>;

export default async function ChatPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  return <ChatView flow={params.flow} />;
}
