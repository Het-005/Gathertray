use strict;
use warnings;

use Archive::Zip qw(:ERROR_CODES :CONSTANTS);
use XML::LibXML;

my $orders_path = q{/Users/sanketbhatt/Downloads/completed-order-report_2025-03-01_2025-11-14_2025-11-14.xlsx};
my $customers_path = q{/Users/sanketbhatt/Downloads/customer-database_2025-05-01_2026-04-15_2026-04-15.xlsx};
my $out_xlsx = q{/Users/sanketbhatt/Documents/New project/bhatel_republic_ezcater_customer_tracker.xlsx};
my $out_csv = q{/Users/sanketbhatt/Documents/New project/bhatel_republic_ezcater_customer_tracker.csv};

sub xml_escape {
  my ($s) = @_;
  $s = q{} unless defined $s;
  $s =~ s/&/&amp;/g;
  $s =~ s/</&lt;/g;
  $s =~ s/>/&gt;/g;
  $s =~ s/"/&quot;/g;
  return $s;
}

sub csv_escape {
  my ($s) = @_;
  $s = q{} unless defined $s;
  $s =~ s/"/""/g;
  return q{"} . $s . q{"};
}

sub col_to_num {
  my ($col) = @_;
  my $n = 0;
  $n = $n * 26 + (ord($_) - 64) for split //, $col;
  return $n;
}

sub num_to_col {
  my ($n) = @_;
  my $s = q{};
  while ($n > 0) {
    my $r = ($n - 1) % 26;
    $s = chr(65 + $r) . $s;
    $n = int(($n - 1) / 26);
  }
  return $s;
}

sub parse_sheet {
  my ($path) = @_;
  my $zip = Archive::Zip->new();
  $zip->read($path) == AZ_OK or die "Failed to read $path\n";

  my $xml = $zip->contents(q{xl/worksheets/sheet1.xml});
  my $doc = XML::LibXML->load_xml(string => $xml);
  my $xpc = XML::LibXML::XPathContext->new($doc);
  $xpc->registerNs('a', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
  my @rows;

  for my $row_node ($xpc->findnodes('//a:sheetData/a:row')) {
    my %vals;
    my $max = 0;

    for my $cell ($xpc->findnodes('./a:c', $row_node)) {
      my ($col) = ($cell->getAttribute('r') // q{}) =~ /([A-Z]+)/;
      next if !$col;
      my $idx = col_to_num($col);
      $max = $idx if $idx > $max;

      my $value = q{};
      if (my ($is) = $xpc->findnodes('./a:is', $cell)) {
        my @parts = map { $_->textContent } $xpc->findnodes('.//a:t', $is);
        $value = join q{}, @parts;
      } elsif (my ($v) = $xpc->findnodes('./a:v', $cell)) {
        $value = $v->textContent;
      }
      $vals{$idx} = $value;
    }

    my @arr = map { defined $vals{$_} ? $vals{$_} : q{} } 1 .. $max;
    push @rows, \@arr;
  }

  return \@rows;
}

sub excel_date_to_ymd {
  my ($serial) = @_;
  return q{} unless defined $serial && $serial ne q{} && $serial =~ /^-?\d+(?:\.\d+)?$/;

  my $days = int($serial);
  my @month_days = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31);
  my ($y, $m, $d) = (1899, 12, 30);

  for (1 .. $days) {
    $d++;
    my $dim = $month_days[$m - 1];
    if ($m == 2) {
      my $leap = (($y % 4 == 0 && $y % 100 != 0) || ($y % 400 == 0)) ? 1 : 0;
      $dim = 29 if $leap;
    }
    if ($d > $dim) {
      $d = 1;
      $m++;
      if ($m > 12) {
        $m = 1;
        $y++;
      }
    }
  }

  return sprintf '%04d-%02d-%02d', $y, $m, $d;
}

sub build_rows {
  my @sources = @_;
  my %merged;

  for my $src (@sources) {
    my $rows = parse_sheet($src);
    my @headers = @{ $rows->[0] || [] };
    my %index;
    for my $i (0 .. $#headers) {
      $index{$headers[$i]} = $i;
    }

    for my $r (1 .. $#$rows) {
      my $row = $rows->[$r];
      my $order = $row->[ $index{'Order Number'} // -1 ] // q{};
      next if !$order || $order eq 'Total';

      my $entry = ($merged{$order} ||= {});
      for my $key (keys %index) {
        my $val = $row->[ $index{$key} ] // q{};
        next if $val eq q{};
        if (!exists $entry->{$key} || $entry->{$key} eq q{}) {
          $entry->{$key} = $val;
        }
      }
    }
  }

  my @out;
  my $grand_total = 0;
  for my $order (keys %merged) {
    my $e = $merged{$order};
    my $event_date = excel_date_to_ymd($e->{'Event Date'} // q{});
    my $submitted_date = excel_date_to_ymd($e->{'Submitted At'} // q{});
    my $customer_name = $e->{'Location'} || q{};
    $customer_name = $e->{'Street Address'} if !$customer_name;
    my $order_total = $e->{'Caterer Total Due'} || q{};
    $grand_total += $order_total if $order_total ne q{} && $order_total =~ /^-?\d+(?:\.\d+)?$/;

    push @out, [
      $customer_name,
      $event_date,
      $order,
      $e->{'Street Address'} || q{},
      $e->{'City'} || q{},
      $e->{'State'} || q{},
      $e->{'Zip Code'} || q{},
      q{},
      q{},
      q{},
      $e->{'Store Name'} || q{},
      $e->{'Caterer Name'} || q{},
      $e->{'Status'} || q{},
      $e->{'Source'} || q{},
      $e->{'Driver'} || q{},
      $submitted_date,
      $order_total,
      q{},
    ];
  }

  @out = sort {
    (($a->[1] // q{}) cmp ($b->[1] // q{})) ||
    (($a->[0] // q{}) cmp ($b->[0] // q{})) ||
    (($a->[2] // q{}) cmp ($b->[2] // q{}))
  } @out;

  push @out, [
    'TOTAL',
    q{},
    q{},
    q{},
    q{},
    q{},
    q{},
    q{},
    q{},
    q{},
    q{},
    q{},
    q{},
    q{},
    q{},
    q{},
    sprintf('%.2f', $grand_total),
    q{},
  ];

  return \@out;
}

my $headers = [
  'Customer Name',
  'Event Date',
  'Order Number',
  'Street Address',
  'City',
  'State',
  'Zip Code',
  'Contact Name',
  'Contact Phone',
  'Contact Email',
  'Store Name',
  'Caterer Name',
  'Order Status',
  'Order Source',
  'Driver',
  'Submitted Date',
  'Order Total Amount',
  'Notes',
];

my $data_rows = build_rows($orders_path, $customers_path);

open my $csv_fh, '>', $out_csv or die "Cannot write $out_csv\n";
print {$csv_fh} join(',', map { csv_escape($_) } @$headers), "\n";
for my $row (@$data_rows) {
  print {$csv_fh} join(',', map { csv_escape($_) } @$row), "\n";
}
close $csv_fh;

my @all_rows = ($headers, @$data_rows);
my $last_col = num_to_col(scalar(@$headers));
my $last_row = scalar(@all_rows);
my @widths = (28, 14, 14, 30, 18, 8, 10, 18, 16, 24, 18, 34, 14, 20, 18, 14, 16, 24);

my $sheet_xml = qq{<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n};
$sheet_xml .= qq{<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n};
$sheet_xml .= qq{  <dimension ref="A1:${last_col}${last_row}"/>\n};
$sheet_xml .= qq{  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>\n};
$sheet_xml .= qq{  <sheetFormatPr defaultRowHeight="15"/>\n};
$sheet_xml .= qq{  <cols>\n};
for my $i (0 .. $#widths) {
  my $w = $widths[$i];
  my $n = $i + 1;
  $sheet_xml .= qq{    <col min="$n" max="$n" width="$w" customWidth="1"/>\n};
}
$sheet_xml .= qq{  </cols>\n};
$sheet_xml .= qq{  <sheetData>\n};
for my $r_idx (0 .. $#all_rows) {
  my $excel_r = $r_idx + 1;
  my $style = $r_idx == 0 ? 1 : 0;
  $sheet_xml .= qq{    <row r="$excel_r">};
  my $row = $all_rows[$r_idx];
  for my $c_idx (0 .. $#$row) {
    my $cell_ref = num_to_col($c_idx + 1) . $excel_r;
    my $val = xml_escape($row->[$c_idx]);
    $sheet_xml .= qq{<c r="$cell_ref" t="inlineStr" s="$style"><is><t xml:space="preserve">$val</t></is></c>};
  }
  $sheet_xml .= qq{</row>\n};
}
$sheet_xml .= qq{  </sheetData>\n};
$sheet_xml .= qq{  <autoFilter ref="A1:${last_col}${last_row}"/>\n};
$sheet_xml .= qq{</worksheet>\n};

my $styles_xml = <<'XML';
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>
XML

my $workbook_xml = <<'XML';
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Customer Tracker" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>
XML

my $content_types = <<'XML';
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
XML

my $root_rels = <<'XML';
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
XML

my $wb_rels = <<'XML';
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
XML

my $core_xml = <<'XML';
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>Codex</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-04-15T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-04-15T00:00:00Z</dcterms:modified>
</cp:coreProperties>
XML

my $app_xml = <<'XML';
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Excel</Application>
</Properties>
XML

my $zip = Archive::Zip->new();
$zip->addString($content_types, '[Content_Types].xml');
$zip->addString($root_rels, '_rels/.rels');
$zip->addString($app_xml, 'docProps/app.xml');
$zip->addString($core_xml, 'docProps/core.xml');
$zip->addString($workbook_xml, 'xl/workbook.xml');
$zip->addString($wb_rels, 'xl/_rels/workbook.xml.rels');
$zip->addString($styles_xml, 'xl/styles.xml');
$zip->addString($sheet_xml, 'xl/worksheets/sheet1.xml');
$zip->writeToFileNamed($out_xlsx) == AZ_OK or die "Failed to write xlsx\n";

print scalar(@$data_rows), " rows written\n$out_xlsx\n$out_csv\n";
