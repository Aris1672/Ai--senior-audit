import re,sys,json
src,outxml,outjson=sys.argv[1:4]
s=open(src,encoding='utf-8-sig').read()
keep_exact=['Catalog_Организации','Catalog_Контрагенты','Catalog_ДоговорыКонтрагентов','Catalog_БанковскиеСчета','Catalog_ФизическиеЛица','Catalog_Номенклатура','Catalog_Валюты',
 'ChartOfAccounts_Хозрасчетный','Document_ПоступлениеНаРасчетныйСчет','Document_СписаниеСРасчетногоСчета','Document_ПоступлениеТоваровУслуг','Document_РеализацияТоваровУслуг','Document_ОперацияБух',
 'AccountingRegister_Хозрасчетный']
sub_ok={'Document_ПоступлениеНаРасчетныйСчет':['РасшифровкаПлатежа'],'Document_СписаниеСРасчетногоСчета':['РасшифровкаПлатежа'],'Document_ПоступлениеТоваровУслуг':['Товары','Услуги'],'Document_РеализацияТоваровУслуг':['Товары','Услуги'],
 'AccountingRegister_Хозрасчетный':['RecordType','ExtDimensions','Balance','Turnover','BalanceAndTurnover','DrCrTurnover','RecordsWithExtDimensions','RowType'],'ChartOfAccounts_Хозрасчетный':['ExtDimensionTypes']}
names=set(keep_exact)
for k,v in sub_ok.items():
    for x in v: names.add(k+'_'+x)
head=s[:s.index('<EntityType ')]
ets=re.findall(r'<EntityType Name="([^"]+)".*?</EntityType>',s,re.S)
blocks={m.group(1):m.group(0) for m in re.finditer(r'<(EntityType|ComplexType) Name="([^"]+)".*?</\1>',s,re.S) for _ in [0] if False}
out=[];summary={};found=set()
for m in re.finditer(r'<(EntityType|ComplexType) Name="([^"]+)".*?</\1>',s,re.S):
    n=m.group(2)
    if n in names or any(n.startswith(k+'_') and n in names for k in keep_exact):
        b=re.sub(r'\s*<NavigationProperty [^>]*/>','',m.group(0))  # navigation links point at objects we drop
        out.append(b); found.add(n)
        summary[n]={'kind':m.group(1),'keys':re.findall(r'<PropertyRef Name="([^"]+)"',b),'props':dict(re.findall(r'<Property Name="([^"]+)"\s+Type="([^"]+)"',b))}
print('missing',sorted(names-found))
sets=[x for x in re.findall(r'<EntitySet [^>]*/>',s) if re.search(r'Name="([^"]+)"',x).group(1) in found]
fis=[m.group(0) for m in re.finditer(r'<FunctionImport Name="[^"]+".*?</FunctionImport>|<FunctionImport [^>]*/>',s,re.S) if 'AccountingRegister_Хозрасчетный' in m.group(0)]
cont=re.search(r'<EntityContainer [^>]*>',s).group(0)
xml=head+'\n'.join(out)+'\n'+cont+'\n'+'\n'.join(sets)+'\n'+'\n'.join(fis)+'\n</EntityContainer>\n</Schema>\n</edmx:DataServices>\n</edmx:Edmx>\n'
open(outxml,'w',encoding='utf-8').write(xml)
summary['__functions']=[re.sub(r'\s+',' ',x) for x in fis]
json.dump(summary,open(outjson,'w',encoding='utf-8'),ensure_ascii=False,indent=1)
print(len(xml),len(out),len(sets),len(fis)); print(s[-200:])
for n in ['AccountingRegister_Хозрасчетный','AccountingRegister_Хозрасчетный_RecordType','AccountingRegister_Хозрасчетный_Turnovers','AccountingRegister_Хозрасчетный_BalanceAndTurnovers','AccountingRegister_Хозрасчетный_Balance']:
    if n in summary: print('\n##',n,summary[n]['keys'],'\n',', '.join(k+':'+v.replace('StandardODATA.','').replace('Edm.','') for k,v in summary[n]['props'].items()))
for x in summary['__functions']: print(x[:420])
