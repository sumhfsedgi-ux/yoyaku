import {
  createMyAcquisitionSource,
  createMyConcernMaster,
  listMyAcquisitionSources,
  listMyConcernMasters,
  renameMyAcquisitionSource,
  renameMyConcernMaster,
  reorderMyAcquisitionSources,
  reorderMyConcernMasters,
  setMyAcquisitionSourceActive,
  setMyConcernMasterActive,
} from "@/actions/masters";
import { MasterListEditor } from "@/components/admin/MasterListEditor";

export default async function ChartSettingsPage() {
  const [concernMasters, acquisitionSources] = await Promise.all([listMyConcernMasters(), listMyAcquisitionSources()]);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <div>
        <h1 className="mb-1 text-xl font-semibold tracking-tight text-foreground">カルテ・分析設定</h1>
        <p className="text-sm text-muted-foreground">
          非表示にした項目は新規の来店記録では選べなくなりますが、過去のカルテ・分析からは消えません。
        </p>
      </div>

      <MasterListEditor
        title="お悩み"
        nameMaxLength={50}
        items={concernMasters}
        onCreate={createMyConcernMaster}
        onRename={renameMyConcernMaster}
        onSetActive={setMyConcernMasterActive}
        onReorder={reorderMyConcernMasters}
      />

      <MasterListEditor
        title="流入経路"
        nameMaxLength={30}
        items={acquisitionSources}
        onCreate={createMyAcquisitionSource}
        onRename={renameMyAcquisitionSource}
        onSetActive={setMyAcquisitionSourceActive}
        onReorder={reorderMyAcquisitionSources}
      />
    </div>
  );
}
