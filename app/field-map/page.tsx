import { FieldMapPage } from "@/components/field-map";
import { getFieldMapView } from "@/src/server";

export const dynamic = "force-dynamic";

/** The AI safety field map (fork #10). ?agenda=<id> opens that agenda. */
export default async function FieldMapRoute({ searchParams }: { searchParams: Promise<{ agenda?: string }> }) {
	const { agenda } = await searchParams;
	return <FieldMapPage initialView={getFieldMapView()} initialAgendaId={agenda} />;
}
