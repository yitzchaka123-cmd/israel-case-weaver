import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Cloud, Download, FileArchive, FileText, Image, ListOrdered } from "lucide-react";
import { exportDocumentsOnly, exportMediaOnly, exportProjectPackage, exportProjectToDrive, exportPromptsOnly } from "@/lib/export";

export function ExportMenu({ projectId }: { projectId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onClick={() => exportProjectPackage(projectId)} className="gap-2">
          <FileArchive className="h-4 w-4" /> Download .zip
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportProjectToDrive(projectId)} className="gap-2">
          <Cloud className="h-4 w-4" /> Save case to Google Drive
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => exportDocumentsOnly(projectId)} className="gap-2">
          <FileText className="h-4 w-4" /> Documents only
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportMediaOnly(projectId)} className="gap-2">
          <Image className="h-4 w-4" /> Media only
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportPromptsOnly(projectId)} className="gap-2">
          <ListOrdered className="h-4 w-4" /> Prompts (JSON)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
