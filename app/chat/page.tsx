import { ChatView } from "@/components/chat/ChatView";
import { regionBySlug } from "@/lib/regions";

type SearchParams = Promise<{ flow?: string; region?: string }>;

export default async function ChatPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const region = regionBySlug(params.region);
  return <ChatView flow={params.flow} region={region} />;
}
