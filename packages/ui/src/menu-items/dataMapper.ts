// packages/ui/src/menu-items/dataMapper.ts
import { GitMerge } from 'lucide-react'; // Use GitMerge icon

const icons = {
    GitMerge
};

const dataMapper = {
    id: 'data-mapper',
    title: 'Data Mapper',
    type: 'item',
    url: '/data-mapper',
    icon: icons.GitMerge,
    breadcrumbs: false
};

export default dataMapper;